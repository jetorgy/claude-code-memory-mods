import type { Register } from 'claude-code'
// Workflow data: stages, their instructions, and the exit gate each must pass. No engine calls here.
export type Stage = { id: string; title: string; text: string; gate?: { file: string; needs: RegExp[]; say: string } }

export const PANEL = `PANEL (two simulated experts, run as subagents; they share one model, so their errors are correlated, never treat agreement as proof):
- ESTIMATOR: gets the question only, no sources and none of your findings. Returns an independent prior answer, confidence, and the evidence that would change it. Run it BEFORE you read sources.
- SKEPTIC: gets the protocol or the draft conclusion. Returns the strongest objections, missing sources, and what a hostile reviewer would say. Run it at the protocol gate and before synthesis.
Record each panel answer with its rationale in the notebook. At every gate, put open disagreements to the user: the user is the tiebreaker and the only real expert.`

export const STAGES: Stage[] = [
  { id: 'clarify', title: 'Clarify',
    text: 'Write research/<slug>/question.md: the question, why it matters, the decision it feeds, what a good answer looks like, scope in and out, and known unknowns. Ask the user about anything that changes the plan. Then run the ESTIMATOR on the question and log its prior.',
    gate: { file: 'question.md', needs: [/decision/i, /scope/i], say: 'question.md needs the decision it feeds and the scope' } },
  { id: 'protocol', title: 'Protocol (pre-commit)',
    text: 'Write research/<slug>/protocol.md BEFORE collecting: sub-questions, source types and where to search, search terms, inclusion and exclusion rules, how each source is appraised, and a "Stopping rule" section (stop when two consecutive rounds add nothing new, or a hard budget of rounds or sources). Run the SKEPTIC on it and fix what it finds. Show the user. Later changes go in a dated "Amendments" section, never silent edits.',
    gate: { file: 'protocol.md', needs: [/stopping rule/i, /sub-?question/i, /exclu/i], say: 'protocol.md needs sub-questions, exclusion rules and a Stopping rule' } },
  { id: 'collect', title: 'Search and collect',
    text: 'Follow the protocol. Log every query to queries.md with date, tool, terms and what came back, including empty results. Search results are summaries: open each kept source with WebFetch and read the actual text. Save each kept source in evidence.md as `E<n> | title url | type | READ: full or READ: summary | SQ | quote`. At least half must be READ: full to leave collect. URL, date, type, and the claim it supports. Trace claims to their upstream source. Prefer primary sources; keep grey literature but label it. Stop collecting for this round when the protocol says so.' },
  { id: 'appraise', title: 'Appraise',
    text: 'For each source: credibility (who, funding, upstream origin, retraction or correction status, lateral check on what others say of it). For each sub-question: certainty high, moderate, low or very low, lowered for bias, inconsistency, indirectness, imprecision, or one-sided sourcing. Triangulate: a claim from one source type is weak. Practitioner and tacit knowledge is a lower-certainty tier unless backed by concrete cases. Write this in evidence.md.' },
  { id: 'iterate', title: 'Iterate',
    text: 'Notebook entry (notebook.md, dated): hypothesis, what was done, result including negative results, interpretation, next step. Compare against the stopping rule. If it is not met, say what the question has sharpened into, amend the protocol openly, and return to collect. If it is met, or the budget is spent, move on.' },
  { id: 'synthesize', title: 'Stop and synthesize',
    text: 'Run the SKEPTIC on the draft conclusion. Write research/<slug>/report.md: answer per sub-question with its certainty, the evidence behind it, disagreements, what was NOT searched or was cut and why, the open questions, and what would change the answer. Add a "## Claims" section, one line per claim: C1: claim | E3,E5 | "a 4+ word span copied from the cited evidence entry". Then call research_stage: it string-matches every span and id (mechanical, no LLM). Never state more confidence than the appraisal supports.',
    gate: { file: 'report.md', needs: [/certaint/i, /not searched|cut|limitations/i], say: 'report.md needs certainty levels and what was cut or not searched' } },
]

export const stageById = (id: string) => STAGES.find(s => s.id === id)
export const nextStage = (id: string) => STAGES[STAGES.findIndex(s => s.id === id) + 1]

export const RULES = `RESEARCH MODE IS ON. Work as a researcher, not a searcher. Rules:
1. Commit to the plan before looking (question, protocol, stopping rule) and amend it only openly.
2. Form your own estimate before reading sources. Default to a normal web search; escalate to full reads or a theoretical crawl ONLY for non-mainstream topics (niche, one researcher's own work, sparsely documented), never for well-known ones.
3. Record reasoning, not just results; negative results count.
4. Separate what a source says from how much it should be trusted.
5. Never claim more certainty than the evidence supports; state what you cut.
6. Use research_log for notebook, queries and evidence entries; use research_stage to move between stages (it checks the gate).
7. Workspace on disk: research/<slug>/ (state.json, question.md, protocol.md, queries.md, evidence.md, notebook.md, report.md).`

export const stageMessage = (slug: string, s: Stage) =>
  `[research:${slug}] Stage: ${s.title}\n${s.text}\n\n${PANEL}`

// Workspace + switch persisted on disk (survives sessions and reloads). Paths relative to the working directory.
const ROOT = 'research'
const flagPath = ($: any): string => `${$.plugin.root}/../../research-mod-state.json`
// research.mjs lives in the sibling session-memory mod: <mods>/research -> <mods>/session-memory/engine
const researchMjs = ($: any): string => `${$.plugin.root}/../session-memory/engine/research.mjs`
export type State = { slug: string; stage: string; question: string; created: string }

export const slugify = (q: string) =>
  q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'untitled'
export const today = () => new Date().toISOString().slice(0, 10)
export const dir = (slug: string) => `${ROOT}/${slug}`

export const isOn = async ($: any): Promise<{ on: boolean; slug?: string }> => {
  try { return JSON.parse(await $.fs.read(flagPath($))) } catch { return { on: false } }
}
export const setOn = (flag: boolean, slug: string | undefined, $: any) => $.fs.write(flagPath($), JSON.stringify({ on: flag, slug }))

export const loadState = async ($: any, slug: string): Promise<State | null> => {
  try { return JSON.parse(await $.fs.read(`${dir(slug)}/state.json`)) } catch { return null }
}
export const saveState = ($: any, s: State) => $.fs.write(`${dir(s.slug)}/state.json`, JSON.stringify(s, null, 2))

export const append = async ($: any, slug: string, file: string, text: string) => {
  const p = `${dir(slug)}/${file}`
  let old = ''
  try { old = await $.fs.read(p) } catch { /* new file */ }
  await $.fs.write(p, `${old}${old && !old.endsWith('\n') ? '\n' : ''}${text}\n`)
}
export const readFile = async ($: any, slug: string, file: string) => {
  try { return String(await $.fs.read(`${dir(slug)}/${file}`)) } catch { return '' }
}


// Layout: switch (flag + phrases + /research on|off) -> notes riding on prompts and tool results (like the
// memory mods' web-search nudges) -> tools I call: research_start, research_log, research_stage.
const ON = /\b(turn|switch|enable|activate|start)\b[^.\n]{0,20}\bresearch\b[^.\n]{0,12}\b(mode|mods?)\b|\bresearch (mode|mods?)\b[^.\n]{0,12}\b(on|enabled)\b/i
const OFF = /\b(turn|switch|disable|deactivate|stop)\b[^.\n]{0,20}\bresearch\b[^.\n]{0,12}\b(mode|mods?)\b|\bresearch (mode|mods?)\b[^.\n]{0,12}\b(off|disabled)\b/i

// Claim ledger (mechanical): report.md "## Claims" lines look like  C1: claim | E3,E5 | "quoted span"
// Each id must exist in evidence.md (lines starting E<n>), and each span (4+ words) must appear in a cited entry.
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim()
export const verifyLedger = (report: string, evidence: string): string[] => {
  const entries = new Map<string, string>()
  for (const l of evidence.split('\n')) { const m = /^(E\d+)\b(.*)$/.exec(l.trim()); if (m) entries.set(m[1], norm(m[2])) }
  const sec = /^##\s*claims\b[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im.exec(report)
  if (!sec) return ['report.md has no "## Claims" section']
  const errs: string[] = []
  const lines = sec[1].split('\n').filter(l => /^\s*(?:[-*]\s*)?C\d+\s*:/.test(l))
  if (!lines.length) return ['"## Claims" has no lines like  C1: claim | E1,E2 | "quoted span"']
  for (const l of lines) {
    const id = /C\d+/.exec(l)?.[0] ?? '?'
    const parts = l.split('|')
    if (parts.length < 3) { errs.push(`${id}: needs  claim | evidence ids | "quoted span"`); continue }
    const ids = parts[1].match(/E\d+/g) ?? []
    const span = norm(parts.slice(2).join('|'))
    if (!ids.length) { errs.push(`${id}: cites no evidence id`); continue }
    const missing = ids.filter(i => !entries.has(i))
    if (missing.length) { errs.push(`${id}: unknown evidence id ${missing.join(', ')}`); continue }
    if (span.split(' ').length < 4) { errs.push(`${id}: quoted span is shorter than 4 words`); continue }
    if (!ids.some(i => entries.get(i)!.includes(span))) errs.push(`${id}: span not found in ${ids.join(', ')}`)
  }
  return errs
}
const SEARCH = new Set(['WebSearch', 'WebFetch'])
const REMIND_EVERY = 12
let calls = 0

const note = (t: string) => `RESEARCH-MODE NOTE (guidance, not a request): ${t}`

const enter = async ($: any, slug: string, stage: string) => {
  const st = await loadState($, slug)
  const s = stageById(stage)
  if (!st || !s) return `No such project or stage (${slug}/${stage}).`
  await saveState($, { ...st, stage })
  return `${slug}: now in stage "${s.title}".\n${stageMessage(slug, s)}`
}

const advance = async ($: any, to?: string): Promise<string> => {
  const { on: active, slug } = await isOn($)
  if (!active || !slug) return 'Research mode is off or has no project. Call research_start first.'
  const st = await loadState($, slug)
  if (!st) return `Project ${slug} has no state.json.`
  const order = STAGES.map(s => s.id)
  if (to && !stageById(to)) return `No such stage "${to}". Stages: ${order.join(', ')}.`
  const cur = stageById(st.stage)
  const target = to ? stageById(to) : nextStage(st.stage)
  const from = cur ? order.indexOf(cur.id) : 0
  // At the last stage there is no target: check that stage's gate and the claim ledger.
  const upTo = target ? order.indexOf(target.id) : order.length
  // Every stage from the current one up to (not including) the target must pass its own gate.
  for (let i = from; i < upTo; i++) {
    const s = STAGES[i]
    if (!s) continue
    if (s.id === 'collect') {
      const ev = await readFile($, slug, 'evidence.md')
      const lines = ev.split('\n').filter(l => /^E\d+\s*\|/.test(l) && !/RETRACT/i.test(l))
      const full = lines.filter(l => /READ:\s*full/i.test(l)).length
      if (lines.length === 0 || full * 2 < lines.length) return `Gate not passed: ${full} of ${lines.length} evidence entries are marked "READ: full". Open the best sources with WebFetch (the paper or PDF itself), pass the fetched text to mcp__session-memory__research_ingest, and tag each entry "READ: full" (or "READ: summary" if you could not open it). At least one entry must exist and at least half must be full before leaving collect.`
    }
    if (s.gate) {
      const text = await readFile($, slug, s.gate.file)
      if (s.gate.needs.some(r => !r.test(text))) return `Gate not passed (${s.title}): ${s.gate.say}. Fix ${dir(slug)}/${s.gate.file}, then retry.`
    }
  }
  if (!target) {
    const errs = verifyLedger(await readFile($, slug, 'report.md'), await readFile($, slug, 'evidence.md'))
    return errs.length ? `Claim ledger FAILED (mechanical check):\n- ${errs.join('\n- ')}\nFix report.md, then call research_stage again.` : 'Claim ledger passed: every claim cites existing evidence and its quoted span is found there. The report is the end.'
  }
  return enter($, slug, target.id)
}

const status = async ($: any): Promise<string> => {
  const cur = await isOn($)
  if (!cur.on) return 'Research mode is OFF.'
  const st = cur.slug ? await loadState($, cur.slug) : null
  return st ? `Research mode ON. Project ${st.slug}, stage ${st.stage}, workspace ${dir(st.slug)}/` : 'Research mode ON, no project yet.'
}

const TOOLS = [
  { name: 'research_start', description: 'Research mode: open a project for a research question (creates research/<slug>/ and starts at the Clarify stage). Call it when research mode is on and no project exists for this question.',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
  { name: 'research_log', description: 'Research mode: append a dated entry to the active project file. file is notebook, queries or evidence.',
    inputSchema: { type: 'object', properties: { file: { type: 'string', enum: ['notebook', 'queries', 'evidence'] }, text: { type: 'string' } }, required: ['file', 'text'] } },
  { name: 'research_stage', description: "Research mode: move to the next stage, or to a named stage (clarify, protocol, collect, appraise, iterate, synthesize). Checks the gate of the current stage and returns the next stage's instructions.",
    inputSchema: { type: 'object', properties: { to: { type: 'string' } } } },
]

export const register: Register = on => {
  on('session.start', async ($: any, e: any, next: any) => {
    await $.command.register({ name: 'research', description: 'Research mode switch: /research on | off | status' })
    for (const t of TOOLS) await $.tool.register({ ...t, isDeferred: false })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__research__research_start' }, async ($: any, e: any) => {
    const cur = await isOn($)
    if (!cur.on) return { result: 'Research mode is off. Do not start a project.' }
    try {
      const slug = slugify(String(e.question))
      const existing = await loadState($, slug)
      if (existing) {
        // Never reset the progress of a project that already exists: resume it.
        await setOn(true, slug, $)
        return { result: `Project ${slug} already exists; resuming at stage "${stageById(existing.stage)?.title}".\n${await enter($, slug, existing.stage)}` }
      }
      await saveState($, { slug, stage: 'clarify', question: String(e.question), created: today() })
      await append($, slug, 'notebook.md', `# Notebook: ${e.question}\nStarted ${today()}.`)
      await setOn(true, slug, $)
      return { result: await enter($, slug, 'clarify') }
    } catch (err) { return { result: `Could not create the project workspace: ${String(err)}` } }
  })
  on('tool.call', { tool: 'mcp__research__research_log' }, async ($: any, e: any) => {
    const { on: active, slug } = await isOn($)
    if (!active || !slug) return { result: 'Research mode is off or has no project.' }
    if (!['notebook', 'queries', 'evidence'].includes(String(e.file))) return { result: 'file must be notebook, queries or evidence.' }
    try { await append($, slug, `${e.file}.md`, `\n## ${today()}\n${e.text}`) } catch (err) { return { result: `Could not write the log: ${String(err)}` } }
    // Everything logged also becomes research nodes (about a paragraph each), so nothing is lost.
    let nodes = ''
    try {
      const r = await $.process.run(['node', '--no-warnings', researchMjs($), '--topic', slug, '--source', `${e.file}.md ${today()}`, '--text', String(e.text ?? '')], { timeoutMs: 20000 })
      nodes = r.exitCode === 0 ? ` ${r.stdout.trim()}` : ''
    } catch { /* ingest is best effort */ }
    return { result: `Logged to ${dir(slug)}/${e.file}.md.${nodes}` }
  })
  on('tool.call', { tool: 'mcp__research__research_stage' }, async ($: any, e: any) => ({ result: await advance($, e?.to) }))


  on('command.run', async ($: any, e: any, next: any) => {
    if (e.command !== 'research') return next(e)
    const a = String(e.args ?? '').trim().toLowerCase()
    if (/\boff\b/.test(a)) { await setOn(false, (await isOn($)).slug, $); return { text: 'Research mode OFF. Workspace files stay in research/.' } }
    if (/\bon\b/.test(a)) { await setOn(true, (await isOn($)).slug, $); return { text: 'Research mode ON. I will follow the research workflow on new questions.' } }
    return { text: await status($) }
  })

  // The switch by phrase, and the workflow rules riding along with each message while on.
  on('prompt.submit', async ($: any, e: any, next: any) => {
    const t = String(e.text ?? '')
    if (t.length < 300) {
      if (OFF.test(t)) { await setOn(false, (await isOn($)).slug, $); $.ui.toast('Research mode OFF') }
      else if (ON.test(t)) { await setOn(true, (await isOn($)).slug, $); $.ui.toast('Research mode ON') }
    }
    const cur = await isOn($)
    if (!cur.on) return next(e)
    const st = cur.slug ? await loadState($, cur.slug) : null
    const where = st
      ? `Active project ${st.slug}, stage "${stageById(st.stage)?.title}". Continue it with research_stage / research_log, or call research_start if this message is a new question.`
      : 'No project yet. If this message is a research question, call research_start with it before searching anything.'
    $.ui.status(`research: ${st ? st.stage : 'no project'}`)
    return next({ ...e, context: [...(e.context ?? []), note(`${RULES}\n${where}`)] })
  })

  // Nudges on my own tool results, the way the memory mods nudge a web search.
  on('tool.call', async ($: any, e: any, next: any) => {
    const ran = await next(e)
    const cur = await isOn($)
    if (!cur.on || !cur.slug || e.tool.startsWith('mcp__research') ) return ran
    const st = await loadState($, cur.slug)
    if (!st) return ran
    calls += 1
    let msg = ''
    if (SEARCH.has(e.tool)) {
      msg = st.stage === 'clarify' || st.stage === 'protocol'
        ? `You searched during the "${st.stage}" stage. The protocol is committed before collecting: finish it and call research_stage first, or say why this search is only scoping.`
        : (e.tool === 'WebSearch'
          ? 'A search result is only a SUMMARY and leads. Do not keep a source from it alone: open the best 2-4 results with WebFetch (the paper or PDF itself) and read the real text. '
          : 'You fetched a page. WebFetch returns a digest, so tag the evidence entry "READ: summary" unless you read the full text yourself (for a PDF: pdftotext, then ingest the file with research_ingest file=...). ')
        + 'Results are auto-saved to the research pool by a hook, and the query is logged by it too. Log each kept source (url, type, claim) to evidence. Before the NEXT search run mcp__session-memory__research_query (it flags repeats); after a round call research_map to see categories and bridges. Then check the protocol\'s stopping rule: did this round add anything new?'
    } else if (calls % REMIND_EVERY === 0) {
      msg = `Stage reminder (${st.stage}): ${stageById(st.stage)?.text.slice(0, 260)} Keep the notebook current; call research_stage when this stage's work is done.`
    }
    if (!msg) return ran
    return { ...ran, context: [...(ran.context ?? []), note(msg)] }
  })
}
