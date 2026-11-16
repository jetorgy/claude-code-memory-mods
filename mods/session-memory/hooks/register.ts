import type { EngineInterface, Register } from 'claude-code'

// session-memory: a paper trail of every saved Claude session, built on Liminal memory.
//  - Before each prompt: search past sessions and attach what clearly matches, labeled as
//    memory and not a request. What was attached is recorded so the memory can learn.
//  - After each turn: read the new log lines into the memory, in the background.
//  - /recall <words> searches by hand; /recall stats shows what the last read found;
//    /recall index reads the logs now.
// The work is in engine/*.mjs (plain Node + Liminal); this file only calls them.

const RECALL_TIMEOUT_MS = 5000
const INDEX_TIMEOUT_MS = 300000
const INDEX_EVERY_MS = 20000

// Flight recorder: one line per decision in ~/.claude/flight-recorder/log.jsonl (view: node view.mjs).
// Fire and forget; a recorder failure never touches the mod.
// The recorder is installed next to the mods folder: <claude home>/flight-recorder/rec.mjs
const recPath = ($: EngineInterface): string => `${$.plugin.root}/../../flight-recorder/rec.mjs`
const rec = ($: EngineInterface, event: string, data: Record<string, unknown>): void => {
  try {
    void $.process.run(['node', recPath($), 'session-memory', event, JSON.stringify(data)], { timeoutMs: 3000 }).catch(() => {})
  } catch {
    // ignore
  }
}


let lastIndexAt = 0
let isIndexing = false

// Off switch. /memory-off creates this file and /memory-on removes it, so the choice survives restarts.
// It is read once, then remembered until the next reload. While it exists the mod does nothing at all:
// no recall, no notes, no window, no saving, no auto-compaction (Claude Code's own setting still applies).
// The switch is the USER's alone: only typing /memory-off or /memory-on does it. Three ways round that are shut:
//  1. the commands refuse when another mod fires them (the event's origin is not Claude Code itself);
//  2. a tool call that tries to run the commands through Skill / SlashCommand is denied;
//  3. a shell command or file write that touches the switch file is denied.
// And talk of switching it on or off is never shown back from memory (engine/store.mjs isSwitchTalk).
const SWITCH_VERB = '(?:turn|switch|toggle|set|put|shut|flip)(?: the| session)*'
const SWITCH_PATTERNS = [
  /\bmemory ?(?:on|off)\b/,
  new RegExp(`\\b${SWITCH_VERB} (?:on|off)(?: the| session)* memory\\b`),
  new RegExp(`\\b${SWITCH_VERB} memory(?: mod| mods| plugin)? (?:on|off)\\b`),
]
// Same rules as isSwitchTalk in engine/store.mjs: every non-letter, non-digit counts as a space.
function switchTalk(text: string): boolean {
  const t = text.normalize('NFKC').toLowerCase().replace(/[\p{Cf}\p{Mn}]/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ')
  return SWITCH_PATTERNS.some(p => p.test(t))
}
function firedByMod(next: unknown): boolean {
  const plugin = (next as { origin?: { plugin?: string } } | undefined)?.origin?.plugin
  return Boolean(plugin) && plugin !== 'engine'
}
const NOT_YOURS = 'Only the user can switch the memory on or off, by typing /memory-off or /memory-on themselves. This was not done.'
function switchAttempt(tool: string, input: Record<string, unknown>): string | null {
  if (/^(skill|slashcommand)$/i.test(tool) && switchTalk(JSON.stringify(input))) return NOT_YOURS
  const cmd = typeof input.command === 'string' ? input.command : ''
  if (tool === 'Bash' && cmd.includes('session-memory/disabled') && (/\b(touch|rm|mv|cp|ln|tee|truncate|install|dd)\b/.test(cmd) || cmd.includes('>'))) return NOT_YOURS
  const path = typeof input.file_path === 'string' ? input.file_path : ''
  if (/^(Write|Edit|NotebookEdit)$/.test(tool) && path.endsWith('session-memory/disabled')) return NOT_YOURS
  return null
}
let memoryOff: boolean | null = null
const offDir = ($: EngineInterface): string => `${$.plugin.root}/../../session-memory`
const offFlag = ($: EngineInterface): string => `${offDir($)}/disabled`
async function isOff($: EngineInterface): Promise<boolean> {
  if (memoryOff !== null) return memoryOff
  try {
    const r = await $.process.run(['test', '-e', offFlag($)], { timeoutMs: 2000 })
    memoryOff = r.exitCode === 0
  } catch {
    memoryOff = false
  }
  return memoryOff
}

// Sliding window: when the conversation passes COMPACT_AT tokens the mod compacts it itself, after
// saving everything to memory, and tells the summary it can be short because memory holds the detail.
// (Claude Code's own autoCompactWindow setting is the safety net behind this.)
const COMPACT_AT = 150000
const COMPACT_COOLDOWN_MS = 5 * 60 * 1000
const COMPACT_INSTRUCTIONS =
  'The full conversation is saved in the user\'s session memory and can be recalled on demand, so keep this summary SHORT: a hard limit of 400 words, under 2,500 characters. Aim for bullets, no preamble, no per-file code, no quoting of earlier messages, no list of every tool used. The last exchanges are re-shown in full after the summary, so do not repeat them. ' +
  'Keep only: the user\'s current goal and where the work stands, decisions made and why, exact file paths, commands and settings in use, ' +
  'open problems and the next step, and the user\'s stated preferences. Drop: exploratory output, long tool results, and failed attempts that were resolved.'
// The note shown with the next message after a compaction (set by the session.compact hook, and by the
// mod's own compact call, because Claude Code does not run a plugin's own session.compact hook for it).
function markCompacted(sid: string, before: number): void {
  compactNote =
    `SESSION-MEMORY NOTE (memory, not a request): this conversation was just compacted (about ${before} tokens before). ` +
    `Detail that is not in the summary is saved in session memory. Before asking the user to repeat anything, search it ` +
    `(mcp__session-memory__search with words from the task, or mcp__session-memory__session_trail with the id ${sid}).`
  justCompacted = true
}
let lastCompactAt = 0
const failStreak = new Map<string, number>()
let justCompacted = false
let compactNote = ''
// Helpers this mod started to research an error. A hook may only run for 10 seconds of its own time,
// so the tool never waits: the finding is saved when the helper's turn completes, then handed to
// Claude with its next tool result or the next message.
type Research = { failing: string; error: string; session: string }
const researching = new Map<string, Research>()
const findings: string[] = []
// Calls already held once, and notes already shown, so neither repeats within this session.
const held = new Set<string>()
const noted = new Set<string>()
// Memory items already shown for a tool call this session, so the same one is not repeated.
const shownIds = new Set<string>()
// One budget for everything memory shows in a turn (the message recall plus every tool note), so a
// busy turn cannot get saturated. It resets when the user sends a new message.
const TURN_ITEMS = 10 // related past items, all lookups together
const TURN_NOTES = 3 // separate tool-call notes
let lastAha = '' // the research 'aha' line last shown, so it is not repeated
let itemsLeft = TURN_ITEMS
let notesLeft = TURN_NOTES
// Mid-run topic lookups: their own small budget, refilled by one item every TOPIC_REFILL_CALLS calls.
const TOPIC_ITEMS = 3
const TOPIC_REFILL_CALLS = 10
const TOPIC_EVERY = 8 // backstop: search again after this many calls without a topic change
let topicLeft = TOPIC_ITEMS
let callCount = 0
let callsSinceTopic = 0
const seenTopics = new Set<string>()
const countItems = (text: string): number => (text.match(/^\d+\. \[/gm) ?? []).length
// Read-only tools: a successful one never needs a similarity search.
const READ_ONLY = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'LS'])
// Tools too routine to check on every call.
const QUIET_TOOLS = new Set(['TodoWrite', 'ToolSearch', 'Skill', 'EnterPlanMode', 'ExitPlanMode'])

// The helper that researches an error. Hidden from the model's own agent list: it is started only
// through the investigate_error tool, so its answer can be saved as a lesson.
const FIXER = {
  name: 'fixer',
  description: 'Finds the root cause and the fix for a specific error, for session memory.',
  prompt:
    'You research one error so it can be fixed and remembered. You get the tool that failed, the exact error, and what was already tried.\n' +
    '1. Find the root cause: read the relevant files, configs and logs; run read-only checks (status, versions, listing, --help, dry runs).\n' +
    '2. Do NOT change files, install anything, or run commands that change state. Research only.\n' +
    '3. Answer in this exact shape, plain and short:\n' +
    'ROOT CAUSE: <one or two sentences>\nFIX: <the concrete steps or command>\nVERIFY: <how to confirm it worked>\nCONFIDENCE: high|medium|low, and why\n' +
    'If you cannot find it, say so in ROOT CAUSE and give the best next check as FIX.',
  tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebSearch', 'WebFetch'],
  model: 'sonnet',
}

// Runs the indexer without making the prompt or the turn wait for it.
function indexInBackground($: EngineInterface): void {
  if (isIndexing) return
  isIndexing = true
  lastIndexAt = Date.now()
  void $.process
    .run(['node', '--no-warnings', `${$.plugin.root}/engine/index.mjs`], { timeoutMs: INDEX_TIMEOUT_MS })
    .then(r => {
      if (r.exitCode !== 0) $.ui.toast(`session-memory: reading logs failed: ${r.stderr.trim().slice(0, 160)}`)
      else {
        const s = JSON.parse(r.stdout.trim().split('\n').pop() || '{}') as { busy?: boolean; nodesAdded?: number }
        if (!s.busy && s.nodesAdded) $.ui.status(`memory: +${s.nodesAdded} new pieces saved`)
      }
    })
    .catch(err => $.ui.toast(`session-memory: could not start the indexer: ${String(err).slice(0, 160)}`))
    .finally(() => {
      isIndexing = false
    })
}

// Runs one engine script and hands back what it printed (or why it failed) as text.
async function runEngine($: EngineInterface, script: string, args: string[], timeoutMs: number): Promise<string> {
  const r = await $.process.run(['node', '--no-warnings', `${$.plugin.root}/engine/${script}`, ...args], { timeoutMs })
  return r.exitCode === 0 ? r.stdout.trim() : `session-memory error: ${r.stderr.trim().slice(0, 400)}`
}


// Saves a web result into the research pool (topic = active research project, else "web").
async function autoIngest($: EngineInterface, e: Record<string, unknown>, ran: any): Promise<any> {
  try {
    const text = String(ran?.text ?? '')
    if (text.length < 200 || ran?.isError) return ran
    let slug = ''
    try { const f = JSON.parse(await $.fs.read(`${$.plugin.root}/../../research-mod-state.json`)); if (f?.on && f.slug) slug = String(f.slug) } catch { /* no project */ }
    const q = String(e.query ?? e.url ?? '')
    const args = ['--topic', slug || 'web', '--source', q.slice(0, 300), '--session', await $.session.id(), '--path', slug ? `research/${slug}` : 'research/web', '--why', `auto-saved ${String(e.tool)} result`, '--text', text.slice(0, 100000)]
    void runEngine($, 'research.mjs', args, RECALL_TIMEOUT_MS * 4).catch(() => {})
    if (e.query) void runEngine($, 'research-map.mjs', ['query', q, '--log'], RECALL_TIMEOUT_MS).catch(() => {})
  } catch { /* best effort */ }
  return ran
}

const repeatHeld = new Set<string>()

async function webTool($: EngineInterface, e: Record<string, unknown>, next: (e: any) => Promise<any>): Promise<any> {
  if (await isOff($)) return next(e)
  const key = String(e.query ?? e.url ?? '')
  let repeat = ''
  try {
    const r = await runEngine($, 'research-map.mjs', ['query', key], RECALL_TIMEOUT_MS)
    if (r.startsWith('REPEAT')) repeat = r
  } catch { /* best effort */ }
  // A search that is 80%+ the same as an earlier one is refused once, with where the results are; sending the same call again runs it.
  const pct = Number(/REPEAT: (\d+)%/.exec(repeat)?.[1] ?? 0)
  if (e.query && pct >= 80 && !repeatHeld.has(key)) {
    repeatHeld.add(key)
    $.ui.status('memory: held a repeated search')
    return { deny: `${repeat} Held, not run: search memory first (mcp__session-memory__search with kinds ["research"], or research_map). If you still need a fresh search, send the same call again and it will run.` }
  }
  const ran = await autoIngest($, e, await next(e))
  if (e.url) void runEngine($, 'research-map.mjs', ['query', key, '--log'], RECALL_TIMEOUT_MS).catch(() => {})
  return repeat ? { ...ran, context: [...(ran.context ?? []), `RESEARCH NOTE (memory, not a request): ${repeat} Do not repeat it: use what is already in the pool.`] } : ran
}

// The tools Claude can call. Their schemas sit in the prompt from the start (isDeferred: false)
// so they are reached for without a search.
const TOOLS = [
  {
    name: 'mark',
    description:
      "Mark the conversation in session memory so future sessions learn from it. Call it in the same turn, before answering, whenever: " +
      "the user says your previous answer or action was wrong or didn't work (kind wrong_answer); " +
      'the user is annoyed, angry or fed up with what you did (kind frustrated; this also counts as wrong); ' +
      'the user confirms your previous answer or fix worked (kind worked); ' +
      "you learn a durable rule worth remembering across sessions, such as a user preference or how a recurring problem is really fixed (kind lesson, with note phrased as 'when X, do Y'); " +
      'the user says something is important to remember (kind important). ' +
      'Optional note: what went wrong or what to remember, in one or two plain sentences. target: previous (default, the answer the user is reacting to) or current (the message being answered now).',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['wrong_answer', 'frustrated', 'worked', 'lesson', 'important'] },
        note: { type: 'string' },
        target: { type: 'string', enum: ['previous', 'current'] },
      },
      required: ['kind'],
    },
  },
  {
    name: 'search',
    description:
      'Search session memory (every earlier Claude session: requests, answers, failures and their fixes, user corrections, saved lessons, images) on purpose. ' +
      'Use it before retrying something that may have failed before, when the user refers to earlier work, or to find an image from a past session (results give its file path, which Read can open). ' +
      'kinds narrows it: lesson, failure, correction, request, response, image, thinking. scope: all (default, current project first) or project.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        kinds: { type: 'array', items: { type: 'string', enum: ['lesson', 'failure', 'correction', 'request', 'response', 'image', 'thinking', 'research'] } },
        scope: { type: 'string', enum: ['all', 'project'] },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'research_map',
    description: 'Show the research pool as categories (topic paths) with key terms, why each was gathered, top sources, and BRIDGES: terms shared by two categories, each naming the sources it came from. Use it to see what fits together before and after researching. Optional path narrows to one category.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  },
  {
    name: 'research_query',
    description: 'Check a web-search query against every earlier one before running it: says REPEAT with the date if a similar query was already run (then search memory first). Set log true to record the query as run.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, log: { type: 'boolean' } }, required: ['query'] },
  },
  {
    name: 'research_ingest',
    description:
      'Save gathered research as RESEARCH NODES in memory: the text is split into about one paragraph per node and nothing is dropped, so it comes back later labelled RESEARCH (not a past chat). ' +
      'Call it with the readable text of every page, paper or search result you kept (pass text, or file for a saved file), with a topic and the source URL or title. Repeats are skipped.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' }, file: { type: 'string' }, topic: { type: 'string' }, source: { type: 'string' }, path: { type: 'string', description: 'category path like research/cad-agents/vision' }, why: { type: 'string', description: 'why this was gathered' }, project: { type: 'string' } },
      required: ['topic'],
    },
  },
  {
    name: 'investigate_error',
    description:
      'Send a helper to find the root cause and fix of an error, and save what it finds as a lesson tied to that error, so next time the fix comes back instead of the error. ' +
      'Use it when an error repeats or the session-memory error watcher says it has happened before without a fix, instead of retrying blindly. ' +
      'Pass failing_tool (the tool that failed), the exact error text, and what was already tried. It waits for the helper (up to 10 minutes) and returns its findings.',
    inputSchema: {
      type: 'object',
      properties: { failing_tool: { type: 'string' }, error: { type: 'string' }, tried: { type: 'string' } },
      required: ['error'],
    },
  },
  {
    name: 'correct_memory',
    description:
      'Fix session memory the moment you see it is wrong or outdated, so it is corrected when it happens and not after. ' +
      'Use it when a remembered item, fix, lesson or "what fixed it before" shown to you is wrong for this case or no longer true: ' +
      'fix = the corrected fix or lesson text (it replaces the old one in every later lookup, at once); forget = true to never show it again; undo = true to restore the original. ' +
      'Name the item by ref (the 8-character tag shown beside each remembered item as "ref xxxxxxxx"), or, for the note "This exact error has happened N times", by failing_tool and error (the error text as shown). ' +
      'Only correct what you have verified in this session; say why in why.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        failing_tool: { type: 'string' },
        error: { type: 'string' },
        fix: { type: 'string' },
        forget: { type: 'boolean' },
        undo: { type: 'boolean' },
        why: { type: 'string' },
      },
    },
  },
  {
    name: 'session_trail',
    description:
      'Show the paper trail of an earlier session: each user message, the answer, tool failures and their fixes, corrections and lessons. ' +
      'query: words from the session title or project, or a session id. With several matches it lists them with ids; call again with the id. Empty query lists the most recent sessions.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'recall',
      description: 'Session memory: /recall active (the active nodes list), /recall <words>, /recall stats, /recall index',
    })
    await $.command.register({ name: 'memory-off', description: 'Turn the session-memory mod off (it does nothing until /memory-on)' })
    await $.command.register({ name: 'memory-on', description: 'Turn the session-memory mod back on' })
    for (const t of TOOLS) await $.tool.register({ ...t, isDeferred: false })
    await $.agent.register(FIXER)
    if (!(await isOff($))) indexInBackground($)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__session-memory__mark' }, async ($, e) => {
    const session = await $.session.id()
    const args = ['--session', session, '--kind', String(e.kind ?? '')]
    if (typeof e.note === 'string' && e.note.trim()) args.push('--note', e.note)
    if (e.target === 'current') args.push('--target', 'current')
    return { result: await runEngine($, 'mark.mjs', args, RECALL_TIMEOUT_MS) }
  })

  on('tool.call', { tool: 'mcp__session-memory__search' }, async ($, e) => {
    const [cwd, session] = await Promise.all([$.session.cwd(), $.session.id()])
    const args = ['--q', String(e.query ?? '').slice(0, 800), '--cwd', cwd, '--session', session, '--plain', '--limit', String(Math.min(5, Number(e.limit) || 5))]
    if (Array.isArray(e.kinds) && e.kinds.length) args.push('--kinds', e.kinds.map(String).join(','))
    if (e.scope === 'project') args.push('--scope', 'project')
    const text = await runEngine($, 'recall.mjs', args, RECALL_TIMEOUT_MS * 2)
    return { result: text || 'Nothing in memory clearly matches that.' }
  })

  on('tool.call', { tool: 'mcp__session-memory__correct_memory' }, async ($, e) => {
    const args = ['--session', await $.session.id()]
    if (typeof e.ref === 'string' && e.ref.trim()) args.push('--ref', e.ref.trim().replace(/^ref\s*/i, ''))
    if (typeof e.failing_tool === 'string' && typeof e.error === 'string') args.push('--tool', e.failing_tool, '--error', e.error.slice(0, 3000))
    if (typeof e.fix === 'string' && e.fix.trim()) args.push('--fix', e.fix)
    if (e.forget === true) args.push('--forget')
    if (e.undo === true) args.push('--undo')
    if (typeof e.why === 'string' && e.why.trim()) args.push('--why', e.why)
    return { result: await runEngine($, 'correct.mjs', args, RECALL_TIMEOUT_MS) }
  })

  on('tool.call', { tool: 'mcp__session-memory__research_map' }, async ($, e) => ({ result: await runEngine($, 'research-map.mjs', ['map', ...(e.path ? ['--path', String(e.path)] : [])], RECALL_TIMEOUT_MS) }))
  on('tool.call', { tool: 'mcp__session-memory__research_query' }, async ($, e) => ({ result: await runEngine($, 'research-map.mjs', ['query', String(e.query ?? ''), ...(e.log ? ['--log'] : [])], RECALL_TIMEOUT_MS) }))

  on('tool.call', { tool: 'mcp__session-memory__research_ingest' }, async ($, e) => {
    const args = ['--topic', String(e.topic ?? ''), '--source', String(e.source ?? ''), '--session', await $.session.id(), '--path', String(e.path ?? ''), '--why', String(e.why ?? ''), '--project', String(e.project ?? '')]
    if (typeof e.text === 'string' && e.text.trim()) args.push('--text', e.text)
    else if (typeof e.file === 'string' && e.file.trim()) args.push('--file', e.file)
    else return { result: 'research_ingest needs text or file.' }
    return { result: await runEngine($, 'research.mjs', args, RECALL_TIMEOUT_MS * 4) }
  })

  on('tool.call', { tool: 'mcp__session-memory__session_trail' }, async ($, e) => {
    const session = await $.session.id()
    return { result: await runEngine($, 'trail.mjs', ['--q', String(e.query ?? ''), '--session', session], RECALL_TIMEOUT_MS * 2) }
  })

  on('command.run', { command: 'memory-off' }, async ($, _e, next) => {
    if (firedByMod(next)) { rec($, 'switch_refused', { state: 'off', by: 'mod' }); return { text: NOT_YOURS } }
    try {
      const flag = offFlag($)
      await $.process.run(['mkdir', '-p', offDir($)], { timeoutMs: 3000 })
      const r = await $.process.run(['touch', flag], { timeoutMs: 3000 })
      if (r.exitCode !== 0) return { text: 'session-memory: could not turn it off (could not write the switch file).' }
      memoryOff = true
      rec($, 'switch', { state: 'off' })
      return { text: 'session-memory is OFF. It will not recall, save notes, show the window or auto-compact until you run /memory-on. Your saved memory is untouched.' }
    } catch (err) {
      return { text: `session-memory: could not turn it off: ${String(err).slice(0, 200)}` }
    }
  })

  on('command.run', { command: 'memory-on' }, async ($, _e, next) => {
    if (firedByMod(next)) { rec($, 'switch_refused', { state: 'on', by: 'mod' }); return { text: NOT_YOURS } }
    try {
      const r = await $.process.run(['rm', '-f', offFlag($)], { timeoutMs: 3000 })
      if (r.exitCode !== 0) return { text: 'session-memory: could not turn it on (could not remove the switch file).' }
      memoryOff = false
      rec($, 'switch', { state: 'on' })
      indexInBackground($)
      return { text: 'session-memory is ON again. It is catching up on anything saved while it was off.' }
    } catch (err) {
      return { text: `session-memory: could not turn it on: ${String(err).slice(0, 200)}` }
    }
  })

  on('command.run', { command: 'recall' }, async ($, e) => {
    const arg = e.args.trim()
    const root = `${$.plugin.root}/engine`
    try {
      if (arg === '' || arg === 'help') {
        return { text: 'session-memory: /recall active shows the active nodes list (add a kind: lesson, failure, correction, request, response, image), /recall <words> searches past sessions, /recall stats shows counts, /recall index reads new logs now.' }
      }
      if (arg === 'active' || arg.startsWith('active ')) {
        const pool = arg.slice('active'.length).trim()
        return { text: await runEngine($, 'active.mjs', pool ? ['--pool', pool] : [], RECALL_TIMEOUT_MS) }
      }
      if (arg === 'stats' || arg === 'index') {
        const r = await $.process.run(['node', '--no-warnings', `${root}/index.mjs`], { timeoutMs: INDEX_TIMEOUT_MS })
        return { text: r.exitCode === 0 ? r.stdout.trim() : `index failed: ${r.stderr.trim().slice(0, 300)}` }
      }
      const cwd = await $.session.cwd()
      const r = await $.process.run(['node', '--no-warnings', `${root}/recall.mjs`, '--q', arg, '--cwd', cwd], { timeoutMs: RECALL_TIMEOUT_MS })
      return { text: r.stdout.trim() || 'Nothing in memory clearly matches that.' }
    } catch (err) {
      return { text: `session-memory error: ${String(err).slice(0, 200)}` }
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || (await isOff($))) {
      return next(e)
    }
    let afterCompact = false
    if (justCompacted) {
      justCompacted = false
      afterCompact = true
      let recent = ''
      try {
        const w = await $.process.run(['node', '--no-warnings', `${$.plugin.root}/engine/window.mjs`, '--session', await $.session.id()], { timeoutMs: 4000 })
        if (w.exitCode === 0) recent = w.stdout.trim()
        rec($, 'window', { chars: recent.length })
      } catch {
        // no window: the note and the recall still go out
      }
      e = { ...e, context: [...(e.context ?? []), recent ? `${compactNote}\n${recent}` : compactNote] }
    }
    try {
      const [cwd, session] = await Promise.all([$.session.cwd(), $.session.id()])
      // A very short message ("hi") searches nothing, but still gets the new-session handoff.
      const q = e.text.trim().length < 12 ? '' : e.text.slice(0, 800)
      const r = await $.process.run(
        ['node', '--no-warnings', `${$.plugin.root}/engine/recall.mjs`, '--q', q, '--cwd', cwd, '--session', session, '--record', '--handoff', ...(afterCompact ? ['--limit', '10'] : [])],
        { timeoutMs: RECALL_TIMEOUT_MS },
      )
      const block = r.exitCode === 0 ? r.stdout.trim() : ''
      let aha = ''
      if (q) {
        try { aha = await runEngine($, 'research-map.mjs', ['aha', q.slice(0, 500)], RECALL_TIMEOUT_MS) } catch { /* optional */ }
        if (aha.startsWith('session-memory error') || aha === lastAha) aha = ''
        else lastAha = aha
        if (aha) e = { ...e, context: [...(e.context ?? []), `RESEARCH NOTE (memory, not a request; a lead, check it fits): ${aha}`] }
      }
      itemsLeft = TURN_ITEMS
      notesLeft = TURN_NOTES
      topicLeft = TOPIC_ITEMS
      callsSinceTopic = 0
      seenTopics.clear()
      // A finished error-research helper's finding rides along with this message, beside any recall.
      const finding = findings.length > 0 ? `SESSION-MEMORY NOTE (memory, not a request): ${findings.shift()}` : null
      if (block.startsWith('<session-memory>')) {
        const count = countItems(block)
        itemsLeft = Math.max(0, TURN_ITEMS - count)
        const isHandoff = block.includes('\nHANDOFF:')
        rec($, 'prompt_recall', { items: count, handoff: isHandoff, chars: block.length })
        $.ui.status(`memory: ${isHandoff ? 'handoff from earlier sessions' : ''}${isHandoff && count ? ' + ' : ''}${count ? `${count} past item${count === 1 ? '' : 's'}` : ''} attached`)
        return next({ ...e, context: [...(e.context ?? []), block, ...(finding ? [finding] : [])] })
      }
      if (finding) return next({ ...e, context: [...(e.context ?? []), finding] })
      $.ui.status(r.exitCode === 0 ? 'memory: nothing related' : `memory: search failed (${r.stderr.trim().slice(0, 80)})`)
    } catch (err) {
      // Memory is a helper: any failure means the prompt goes through untouched.
      $.ui.status(`memory: search failed (${String(err).slice(0, 80)})`)
    }
    return next(e)
  })

  on('agent.offer', { agent: 'session-memory:fixer' }, () => ({ isOffered: false }))

  on('tool.call', { tool: 'mcp__session-memory__investigate_error' }, async ($, e) => {
    const error = String(e.error ?? '').slice(0, 3000)
    const tried = String(e.tried ?? '').slice(0, 1500)
    const failing = typeof e.failing_tool === 'string' ? e.failing_tool : ''
    const cwd = await $.session.cwd()
    const started = await $.agent.spawn({
      subagentType: 'session-memory:fixer',
      description: 'Research an error',
      prompt: `Working folder: ${cwd}\nTool that failed: ${failing || 'unknown'}\nExact error:\n${error}\n\nAlready tried:\n${tried || '(nothing noted)'}`,
    })
    if (started.deny !== undefined || !started.agentId) return { result: `Could not start the helper: ${started.deny ?? 'no agent id'}` }
    researching.set(started.agentId, { failing, error, session: await $.session.id() })
    return {
      result:
        'A helper is researching this error in the background (read-only). Do not wait for it and do not retry blindly: carry on with other work. ' +
        'When it finishes, its finding is saved to memory as a lesson tied to this error and shown to you here with your next step.',
    }
  })

  // The tool watcher, around every tool call:
  // Auto-ingest: every WebSearch / WebFetch result is saved whole into the research pool and its query logged,
  // by code, not by the model (fewer model tokens). Best effort, never blocks or alters the call.
  // Before a search or fetch: a code check (no model) for a repeat of an earlier query or URL; a repeat adds a note to the result.
  on('tool.call', { tool: 'WebSearch' }, async ($, e, next) => webTool($, e as Record<string, unknown>, next))
  on('tool.call', { tool: 'WebFetch' }, async ($, e, next) => webTool($, e as Record<string, unknown>, next))

  //  BEFORE: check this exact call against its history. One that failed 2+ times and never worked is
  //          held once per session, with the known cause, so it is not repeated blindly.
  //  AFTER:  attach what memory knows (a saved lesson for this tool, a repeated failure on this
  //          target, or, if the call failed, a known fix for that exact error) before the next step.
  on('tool.call', async ($, e, next) => {
    // First, and even while the memory is off: the model may not flip the switch by any route.
    const blocked = switchAttempt(e.tool, e as Record<string, unknown>)
    if (blocked) {
      rec($, 'switch_refused', { tool: e.tool, by: 'model' })
      return { deny: blocked }
    }
    if (e.tool.startsWith('mcp__session-memory__') || QUIET_TOOLS.has(e.tool) || (await isOff($))) return next(e)
    const { tool: _tool, tool_use_id: _id, ...input } = e as Record<string, unknown>
    let hint: { deny?: string; note?: string; seenFail?: boolean } = {}
    let project = ''
    try {
      project = (await $.session.cwd()).split('/').filter(Boolean).pop() ?? ''
      hint = JSON.parse(await runEngine($, 'toolhint.mjs', ['--tool', e.tool, '--input', JSON.stringify(input).slice(0, 2500), '--project', project], 3000)) as typeof hint
    } catch {
      // The check is a helper: if it cannot run, the call goes ahead untouched.
    }
    const callKey = `${e.tool}:${JSON.stringify(input).slice(0, 400)}`
    if (hint.deny && !held.has(callKey)) {
      held.add(callKey)
      rec($, 'held_call', { tool: e.tool })
      $.ui.status('memory: held a call that failed before')
      return { deny: hint.deny }
    }
    const ran = await next(e)
    if (ran.deny !== undefined) return ran // another plugin refused the call; nothing ran
    const notes: string[] = []
    if (hint.note && !noted.has(hint.note)) {
      noted.add(hint.note)
      notes.push(hint.note)
    }
    // The most related past things (similarity-ranked, at most 5, strong matches only): after a
    // failure always; after a success only for a tool that has failed before (and not read-only).
    const failed = ran.isError === true
    if (itemsLeft > 0 && notesLeft > 0 && (failed || (hint.seenFail === true && !READ_ONLY.has(e.tool)))) {
      try {
        const args = ['--tool', e.tool, '--input', JSON.stringify(input).slice(0, 2500), '--project', project, '--session', await $.session.id(), '--limit', String(Math.min(5, itemsLeft))]
        if (failed) args.push('--error', (ran.text ?? '').slice(0, 1500))
        else args.push('--strict')
        const found = JSON.parse(await runEngine($, 'callmem.mjs', args, 4000)) as { note?: string; ids?: string[] }
        const fresh = (found.ids ?? []).filter(id => !shownIds.has(id))
        if (found.note && fresh.length > 0) {
          for (const id of found.ids ?? []) shownIds.add(id)
          itemsLeft -= Math.max(1, countItems(found.note))
          notesLeft -= 1
          notes.push(`Most related past items for this call: ${found.note}`)
          $.ui.status(`memory: ${(found.note.match(/^\d+\. \[/gm) ?? []).length} related past item(s) for this call`)
        }
      } catch {
        // a helper: the call's result stands as it is
      }
    }
    if (failed && notesLeft > 0) {
      try {
        const out = await runEngine($, 'errors.mjs', ['--tool', e.tool, '--body', (ran.text ?? '').slice(0, 2000)], RECALL_TIMEOUT_MS)
        const info = JSON.parse(out) as { known?: boolean; count?: number; fix?: string | null; lesson?: string | null; project?: string; corrected?: boolean }
        if (info.known) {
          const seen = `This exact error (${e.tool}) has happened ${info.count} time${info.count === 1 ? '' : 's'} before${info.project ? `, last in ${info.project}` : ''}.`
          notes.push(
            info.lesson || info.fix
              ? `${seen}${info.lesson ? ` ${info.corrected ? 'Corrected fix' : 'Researched fix'}: ${info.lesson.slice(0, 400)}` : ''}${info.fix ? ` What fixed it before: ${info.fix.slice(0, 300)}` : ''} Check it applies here; if it is wrong, correct it now with mcp__session-memory__correct_memory (failing_tool "${e.tool}" plus this error text).`
              : `${seen} It was never fixed. Do not retry blindly: run a WebSearch now with the exact error text plus the tool or library name, read the best result, and apply what it says. Use mcp__session-memory__investigate_error as well if the search is not enough.`,
          )
          $.ui.status(`memory: seen this error ${info.count}× before`)
        }
      } catch {
        // see above
      }
    }
    // The same error twice in this session with no fix on record: search the web instead of retrying.
    if (failed) {
      const sig = `${e.tool}:${(ran.text ?? '').replace(/\s+/g, ' ').slice(0, 80)}`
      const n = (failStreak.get(sig) ?? 0) + 1
      failStreak.set(sig, n)
      if (n === 2 && !notes.some(x => x.includes('WebSearch'))) {
        notes.push(`This same ${e.tool} error has now happened twice in this session and no fix is on record. Stop retrying: run a WebSearch now with the exact error text plus the tool or library name, then apply what the best source says.`)
        rec($, 'websearch_nudge', { tool: e.tool, why: 'repeat-in-session' })
      }
    }
    // Topic drift during a long run: when the work moves to a new area (a different folder or tool
    // family) or every TOPIC_EVERY calls, search past requests/answers/lessons for what this call is
    // about. Strict matches only, own small budget that refills, so a long run still sees memory.
    callCount += 1
    callsSinceTopic += 1
    if (callCount % TOPIC_REFILL_CALLS === 0) topicLeft = Math.min(TOPIC_ITEMS, topicLeft + 1)
    if (!failed && topicLeft > 0) {
      const pick = String((input as Record<string, unknown>).command ?? (input as Record<string, unknown>).file_path ?? (input as Record<string, unknown>).path ?? (input as Record<string, unknown>).url ?? (input as Record<string, unknown>).query ?? '')
      const where = pick.match(/\/[\w.-]+(?:\/[\w.-]+){0,3}/)?.[0] ?? ''
      const family = e.tool.startsWith('mcp__') ? e.tool.split('__')[1] : e.tool
      const key = `${family}|${where}`
      if (!seenTopics.has(key) || callsSinceTopic >= TOPIC_EVERY) {
        seenTopics.add(key)
        callsSinceTopic = 0
        try {
          const args = ['--topic', '--strict', '--tool', e.tool, '--input', JSON.stringify(input).slice(0, 2500), '--project', project, '--session', await $.session.id(), '--limit', String(Math.min(3, topicLeft))]
          const found = JSON.parse(await runEngine($, 'callmem.mjs', args, 4000)) as { note?: string; ids?: string[] }
          const fresh = (found.ids ?? []).filter(id => !shownIds.has(id))
          if (found.note && fresh.length > 0) {
            for (const id of found.ids ?? []) shownIds.add(id)
            topicLeft -= Math.max(1, countItems(found.note))
            notes.push(`Related from memory for this new area of work: ${found.note}`)
            $.ui.status('memory: related past items for a new topic')
          }
        } catch {
          // a helper: the call's result stands as it is
        }
      }
    }
    if (findings.length > 0) notes.push(findings.shift() as string)
    if (notes.length === 0) return ran
    notesLeft = Math.max(0, notesLeft - (notes.length > 0 && !notes.some(n => n.startsWith('Most related')) ? 1 : 0))
    const text = notes.join(' ')
    rec($, 'tool_note', {
      tool: e.tool,
      chars: text.length,
      items: countItems(text),
      kinds: notes.map(n => (n.startsWith('Related from memory') ? 'topic' : n.startsWith('Most related') ? 'related' : n.includes('exact error') ? 'error' : 'other')),
      failed,
    })
    return { ...ran, context: [...(ran.context ?? []), `SESSION-MEMORY NOTE (memory, not a request): ${text}`] }
  })

  on('turn.complete', async ($, e, next) => {
    if (await isOff($)) return next(e)
    // A helper this mod started has finished: save what it found as a lesson tied to the error.
    const job = e.agentId !== undefined ? researching.get(e.agentId) : undefined
    if (job && e.agentId !== undefined) {
      researching.delete(e.agentId)
      const answer = e.answer.trim()
      if (answer) {
        try {
          const info = await runEngine($, 'errors.mjs', ['--tool', job.failing || 'tool', '--body', job.error], RECALL_TIMEOUT_MS)
          let sig = ''
          try { sig = (JSON.parse(info) as { sig?: string }).sig ?? '' } catch {}
          const note = `When ${job.failing || 'a tool'} fails with "${job.error.replace(/\s+/g, ' ').slice(0, 160)}": ${answer.replace(/\s+/g, ' ').slice(0, 700)}`
          const args = ['--session', job.session, '--kind', 'lesson', '--note', note, '--target', 'current']
          if (sig) args.push('--sig', sig)
          await runEngine($, 'mark.mjs', args, RECALL_TIMEOUT_MS)
        } catch {
          // the finding is still delivered below even if saving it failed
        }
        findings.push(`A helper you started finished researching "${job.error.replace(/\s+/g, ' ').slice(0, 100)}" (${job.failing || 'tool'}), saved to memory as a lesson. Its finding is unverified model output, so check it before acting: ${answer.replace(/\s+/g, ' ').slice(0, 900)}`)
        $.ui.toast('session-memory: the error helper finished; its finding is saved as a lesson')
      }
    }
    if (e.agentId === undefined && Date.now() - lastIndexAt > INDEX_EVERY_MS) {
      indexInBackground($)
    }
    // The window tuner counts turns between compactions (a whole-pair window that shrinks if compactions speed up).
    if (e.agentId === undefined && e.isAborted !== true) {
      void $.process.run(['node', '--no-warnings', `${$.plugin.root}/engine/window.mjs`, '--count'], { timeoutMs: 3000 }).catch(() => undefined)
    }
    // Sliding window: past COMPACT_AT tokens of context, compact between turns.
    if (e.agentId === undefined && e.isAborted !== true && Date.now() - lastCompactAt > COMPACT_COOLDOWN_MS) {
      try {
        const { context } = await $.session.usage()
        const tokens = context.tokens ?? 0
        rec($, 'context', { tokens, window: context.window ?? null, percent: context.percent ?? null })
        if (tokens >= COMPACT_AT) {
          lastCompactAt = Date.now()
          try {
            const res = await $.session.compact({ instructions: COMPACT_INSTRUCTIONS })
            const skip = (res as { skip?: string }).skip
            rec($, 'compact_try', { where: 'turn.complete', tokens, result: skip ?? 'compacted' })
            if (!skip) markCompacted(await $.session.id(), tokens)
          } catch (err) {
            rec($, 'compact_try', { where: 'turn.complete', tokens, error: String(err).slice(0, 240) })
            // The Desktop app and SDK sessions have no direct compact call; there, compaction is the
            // /compact command. Run it the way the host asks (a prompt starting with / is refused): it goes
            // through this mod's session.compact hook (memory saved first, short summary, note afterwards).
            try {
              void $.command
                .run({ command: 'compact' })
                .then(r => rec($, 'compact_try', { where: 'command.run', tokens, result: JSON.stringify(r ?? null).slice(0, 200) }))
                .catch(err2 => rec($, 'compact_try', { where: 'command.run', tokens, error: String(err2).slice(0, 240) }))
            } catch (err3) {
              rec($, 'compact_try', { where: 'command.run', tokens, error: String(err3).slice(0, 240) })
            }
          }
        }
      } catch (err) {
        // usage unavailable: nothing to do this turn
        rec($, 'context_error', { error: String(err).slice(0, 240) })
      }
    }
    return next(e)
  })

  // Every compaction, whoever starts it (the user, the engine's threshold, or this mod): save the
  // conversation to memory first, tell the summary it can be short, and leave a note for the next message.
  on('session.compact', async ($, e, next) => {
    if (await isOff($)) return next(e)
    // Never block a compaction because of this mod: any failure below falls through to a plain one.
    let instructions: string | undefined
    try {
      let before = 0
      try {
        before = (await $.session.usage()).context.tokens ?? 0
      } catch {
        // unknown size: logged as 0
      }
      try {
        await $.process.run(['node', '--no-warnings', `${$.plugin.root}/engine/index.mjs`], { timeoutMs: 8000 })
      } catch {
        // the 20-second background indexer has most of it already
      }
      const sid = await $.session.id()
      compactNote =
        `SESSION-MEMORY NOTE (memory, not a request): this conversation was just compacted (about ${before} tokens before). ` +
        `Detail that is not in the summary is saved in session memory. Before asking the user to repeat anything, search it ` +
        `(mcp__session-memory__search with words from the task, or mcp__session-memory__session_trail with the id ${sid}).`
      justCompacted = true
      rec($, 'compact', { trigger: (e as { trigger?: string }).trigger ?? '?', tokensBefore: before })
      const prior = (e as { instructions?: string }).instructions
      instructions = prior ? `${prior}\n${COMPACT_INSTRUCTIONS}` : COMPACT_INSTRUCTIONS
    } catch {
      return next(e)
    }
    return next({ ...e, instructions })
  })
}
