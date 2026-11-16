// Turns one line of a saved session log into Liminal nodes and links: the paper trail.
//
// Hierarchy:  group (drive / top folder) -> project (the folder Claude worked in) -> session
//             (with its saved title) -> helper (a sub-agent's own transcript)
// Content pools: request, correction, response, thinking, tool_call, failure, success, image.
// Every content node records who (user / claude / tool / helper), when (ts), where (cwd,
// project, session), how (model, effort, tool), what (its text), why (parent request),
// outcome, and evidence (src: the exact log file and line it came from).
import { createHash } from 'node:crypto'
import { writeFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { put, IMAGES } from './store.mjs'
import { reinforce, penalize } from './strength.mjs'

const SKIP = /^\{"type":"(api-request|file-history|atis|queue-operation|last-prompt|agent-name|cost-state|tools-used|mode)/
const CORRECTION = /\b(wrong|incorrect|that'?s not|not what i|didn'?t work|doesn'?t work|does not work|still (broken|not|fails|wrong|shows|using)|you (forgot|missed|didn'?t|did not|broke)|not (right|correct|working)|that'?s not it)\b|^no[,.! ]/i
const NOT_A_REQUEST = /^(<local-command-caveat>|<command-name>|<local-command-stdout>|<command-message>|<bash-input>|<bash-stdout>|\[?SYSTEM NOTIFICATION)|<task-notification>|<side-sessions-event>|^<agent-message|^\[Subagent hand-back\]|^Another Claude session sent a message|^This session is being continued from a previous conversation/
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s)
// A usage-limit notice: the work was cut off here, not finished. Kept as a marker of where it stopped.
// Errors that are not the tool's fault: the permission checker having an outage, a permission prompt
// the user declined, a stale page reference. They say nothing about whether the call itself works,
// so they never count toward "this call keeps failing".
export const HARNESS_ERROR = /auto mode classifier|Permission for this action was denied|Permission to use .* (has been|was) denied|user (doesn't|does not) want to proceed|tool use was rejected|usage limit|ref(erence)? .*(stale|outside the viewport)|Request interrupted/i
export const LIMIT_HIT = /hit your (\d+-hour |weekly |session |usage )?limit|usage limit (was )?reached|limit · resets/i
const RESUMED = /hit my usage limit while you were working|continue from where you left off/i

export function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
}

// Strips what must never become memory: the memory's own recall block (so it never learns
// from itself), harness reminders, and image-path noise.
export function scrub(t) {
  return t
    .replace(/<session-memory>[\s\S]*?(<\/session-memory>|$)/g, '')
    .replace(/MEMORY RECALL, NOT A REQUEST[\s\S]*$/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/\[Image: source: [^\]]*\]/g, '[image]')
    .trim()
}

export function cleanRequest(t) {
  return scrub(t).replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, m => clip(m, 400)).trim()
}

// "/media/USER/DriveName/myproject" -> { project: "myproject", grp: "DriveName" }
export function placeOf(cwd, groups = {}) {
  const parts = cwd.split('/').filter(Boolean)
  let project = parts[parts.length - 1] || 'home'
  if (cwd.includes('/scratch-workspaces/')) project = 'scratch'
  for (const [frag, name] of Object.entries(groups)) if (cwd.toLowerCase().includes(frag.toLowerCase())) return { project, grp: name }
  let grp = 'other'
  if (parts[0] === 'media' && parts.length >= 3) grp = parts[2]
  else if (parts[0] === 'mnt' && parts.length >= 2) grp = parts[1]
  else if (parts[0] === 'home' && parts.length >= 3) grp = parts[2].startsWith('.') ? 'config' : ['Desktop', 'Documents', 'Downloads'].includes(parts[2]) ? parts[2] : 'home'
  else if (parts[0] === 'home') grp = 'home'
  return { project, grp }
}

// The fingerprint of an error, so the same mistake made again is recognized as the same memory:
// tool plus the error text with numbers, ids, paths and quotes taken out.
export function signatureOf(tool, body) {
  const t = body.toLowerCase()
    .replace(/<\/?tool_use_error>/g, '')
    .replace(/\/[^\s'"]+/g, '<path>')
    .replace(/\b[0-9a-f]{8,}\b/g, '<id>')
    .replace(/\d+/g, '#')
    .replace(/(['"`]).*?\1/g, '<q>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
  return `${tool ?? 'tool'}|${t}`
}

// What a tool call was aimed at, so a failure is paired with a fix aimed at the same thing.
export function targetOf(input) {
  if (!input || typeof input !== 'object') return ''
  if (typeof input.file_path === 'string') return input.file_path
  if (typeof input.command === 'string') return input.command.trim().split(/\s+/).slice(0, 2).join(' ')
  return String(input.url ?? input.pattern ?? input.path ?? '')
}

export function summarizeInput(input) {
  if (!input || typeof input !== 'object') return ''
  const pick = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt ?? input.path
  return typeof pick === 'string' ? clip(pick, 300) : clip(JSON.stringify(input), 300)
}

// Images are saved once, named by their fingerprint; the node only holds the pointer.
function saveImage(block) {
  const src = block.source
  if (!src || src.type !== 'base64' || typeof src.data !== 'string') return null
  const bytes = Buffer.from(src.data, 'base64')
  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 24)
  const ext = (src.media_type || 'image/png').split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  const file = join(IMAGES, `${id}.${ext}`)
  if (!existsSync(file)) writeFileSync(file, bytes, { mode: 0o600 })
  return { id, file }
}

async function ensurePlace(mem, ctx, cwd) {
  const { project, grp } = placeOf(cwd, ctx.cfg.groups)
  const g = `g:${grp}`, p = `p:${grp}/${project}`, s = `s:${ctx.session}`
  if (!mem.has(g)) await put(mem, 'group', { id: g, metadata: { name: grp } })
  if (!mem.has(p)) { await put(mem, 'project', { id: p, metadata: { name: project, grp, cwd } }); mem.link(p, g) }
  if (!mem.has(s)) await put(mem, 'session', { id: s, metadata: { session: ctx.session, title: ctx.helper ? null : ctx.st?.title ?? null, firstCwd: cwd } })
  mem.link(s, p) // a session that moved folders links to every project it worked in
  if (ctx.helper && !mem.has(`h:${ctx.helper}`)) { await put(mem, 'helper', { id: `h:${ctx.helper}`, metadata: { session: ctx.session } }); mem.link(`h:${ctx.helper}`, s) }
  return { project, grp }
}

// The learning record: was a memory block attached to this request? If so, remember which
// nodes it fed (darkmind's "retrieved" field), link to them, and count it as a real reuse.
async function attachRecall(mem, ctx, req, text, ts) {
  const list = ctx.recalls?.get(ctx.session)
  if (!list) return
  const head = text.slice(0, 120)
  const hit = list.find(r => !r.used && Math.abs(r.ts - ts) < 5 * 60e3 && head.startsWith(r.q.slice(0, Math.min(60, r.q.length))))
  if (!hit) return
  hit.used = true
  req.metadata.retrieved = hit.ids
  for (const id of hit.ids) {
    // A memory pulled from cold storage and used comes back into active memory.
    if (!(await ctx.ensureActive(id))) continue
    const n = mem.get(id)
    mem.link(req.id, id, ts) // decaying edge: "this request was shown that memory"
    reinforce(n.metadata, ts)
  }
}

// ctx: { mem, cfg, session, helper, st, recalls, sigs, ensureActive, src }; st is this transcript's
// carried state, sigs maps an error fingerprint to its one memory, ensureActive(id) warms a cold node.
export async function processLine(ctx, raw) {
  if (SKIP.test(raw)) return 0
  let o
  try { o = JSON.parse(raw) } catch { return 0 }
  if (!o || typeof o !== 'object') return 0
  const { mem, st } = ctx

  if (o.type === 'custom-title' && typeof o.customTitle === 'string') {
    if (!ctx.helper) st.title = o.customTitle // kept until the session exists, if it does not yet
    const s = mem.get(`s:${ctx.session}`)
    if (s && !ctx.helper) s.metadata.title = o.customTitle
    return 0
  }

  // The project is the folder the session started in; it changes only when the session itself
  // is moved to another folder, not when a command runs in a sub-folder.
  if (o.type === 'relocated' && typeof o.relocatedCwd === 'string') {
    st.home = o.relocatedCwd
    Object.assign(st, await ensurePlace(mem, ctx, o.relocatedCwd))
    return 0
  }
  const ts = Date.parse(o.timestamp) || 0
  if (typeof o.cwd === 'string') {
    if (!st.home) { st.home = o.cwd; Object.assign(st, await ensurePlace(mem, ctx, o.cwd)) }
    st.cwd = o.cwd
  }
  if (!st.cwd) return 0 // nothing placeable yet
  const who = ctx.helper ? 'helper' : null
  const meta = { session: ctx.session, helper: ctx.helper, project: st.project, grp: st.grp, cwd: st.cwd, ts, src: ctx.src }
  const sess = mem.get(`s:${ctx.session}`)
  if (sess && ts) { sess.metadata.firstTs ??= ts; sess.metadata.lastTs = Math.max(sess.metadata.lastTs ?? 0, ts) }
  const add = async (pool, n) => {
    const node = await put(mem, pool, { id: n.id, content: n.text ?? null, metadata: { ...meta, ...n.meta } })
    if (node) mem.link(n.id, ctx.helper ? `h:${ctx.helper}` : `s:${ctx.session}`)
    return node
  }
  const req = () => (st.lastRequest ? mem.get(st.lastRequest) : null)
  let made = 0

  const handleRequest = async (id, rawText, images) => {
    const text = cleanRequest(rawText)
    if (!text && images.length === 0) return
    if (NOT_A_REQUEST.test(text)) return
    const prevAnswer = st.lastResponse ? mem.get(st.lastResponse) : null
    const isCorrection = Boolean(prevAnswer) && CORRECTION.test(text.slice(0, 400))
    const node = await add(isCorrection ? 'correction' : 'request', { id, text: clip(text, 3000), meta: { who: who ?? 'user', calls: 0, failures: 0, fixed: 0, corrects: isCorrection ? st.lastResponse : null, resumed: RESUMED.test(text) || undefined } })
    if (!node) return
    made++
    if (isCorrection && prevAnswer) {
      mem.link(id, prevAnswer.id)
      prevAnswer.metadata.outcome = 'corrected'
      prevAnswer.metadata.correctedBy = id
      const wrongReq = mem.get(prevAnswer.metadata.parent)
      if (wrongReq) {
        wrongReq.metadata.outcome = 'corrected'
        // Anti-Hebbian: whatever memory fed the answer the user just called wrong loses strength.
        if (!wrongReq.metadata.penalized) {
          wrongReq.metadata.penalized = true // an explicit mark for the same answer will not count it twice
          for (const rid of wrongReq.metadata.retrieved ?? []) { const r = mem.get(rid); if (r) penalize(r.metadata, ts) }
        }
      }
    }
    await attachRecall(mem, ctx, node, text, ts)
    for (const im of images) {
      const imId = `im:${im.id}:${id}`
      if (await add('image', { id: imId, text: `image sent by ${who ?? 'the user'} with: ${clip(text, 300) || '(no text)'}`, meta: { parent: id, image: im.file } })) (st.pendingImages ??= []).push(imId)
    }
    st.lastRequest = id
  }

  // A message typed while Claude was mid-turn is saved as an attachment, not a user line.
  if (o.type === 'attachment' && o.attachment?.type === 'queued_command' && typeof o.attachment.prompt === 'string') {
    await handleRequest(`q:${o.uuid}`, o.attachment.prompt, [])
    return made
  }

  const content = o.message?.content
  if (o.type === 'user') {
    const blocks = Array.isArray(content) ? content : []
    for (const b of blocks) {
      if (b.type !== 'tool_result') continue
      const parentId = `tu:${b.tool_use_id}`
      const call = mem.get(parentId)
      const tool = call?.metadata?.tool ?? null
      const body = scrub(typeof b.content === 'string' ? b.content : textOf(b.content))
      if (body.startsWith('SESSION-MEMORY HOLD')) continue // the mod's own pre-call hold is not a real failure
      const failed = b.is_error === true || /<tool_use_error>/.test(body)
      const id = `tr:${b.tool_use_id}`
      const r = mem.get(call?.metadata?.parent)
      let failureId = null
      if (failed) {
        // The same mistake again strengthens one memory with a count instead of adding a duplicate:
        // a problem that keeps happening stays strong until it stops happening.
        const sig = signatureOf(tool, body)
        const known = ctx.sigs[sig]
        if (known && (await ctx.ensureActive(known))) {
          const f = mem.get(known)
          f.metadata.count = (f.metadata.count ?? 1) + 1
          f.metadata.lastSeen = ts
          f.metadata.seen = [...(f.metadata.seen ?? []), { session: ctx.session, ts, src: ctx.src }].slice(-20)
          reinforce(f.metadata, ts)
          failureId = known
        } else {
          if (!(await add('failure', { id, text: `${tool ?? 'tool'} FAILED: ${clip(body, 1200)}`, meta: { who: 'tool', parent: parentId, request: call?.metadata?.parent ?? null, tool, target: call?.metadata?.target ?? '', outcome: 'failed', sig, count: 1, lastSeen: ts } }))) continue
          ctx.sigs[sig] = id
          failureId = id
        }
        made++
        if (call) { mem.link(parentId, failureId); call.metadata.result = failureId }
      } else {
        if (!(await add('success', { id, text: `${tool ?? 'tool'} ok: ${clip(body, 1200)}`, meta: { who: 'tool', parent: parentId, request: call?.metadata?.parent ?? null, tool, target: call?.metadata?.target ?? '', outcome: 'ok' } }))) continue
        made++
        if (call) { mem.link(parentId, id); call.metadata.result = id }
      }
      if (Array.isArray(b.content)) {
        for (const x of b.content) {
          if (x.type !== 'image') continue
          const im = saveImage(x)
          const imId = im && `im:${im.id}:${id}`
          if (im && (await add('image', { id: imId, text: `image from ${(tool ?? 'tool').replace(/^mcp__/, '')} while working on: ${clip(r?.content ?? '', 240)}`, meta: { parent: id, image: im.file } }))) (st.pendingImages ??= []).push(imId)
        }
      }
      if (failed) {
        if (r) r.metadata.failures++
        ;(st.openFailures ??= []).push({ id: failureId, tool, target: call?.metadata?.target ?? '', req: call?.metadata?.parent ?? null, ts })
        if (st.openFailures.length > 30) st.openFailures.shift()
      } else if (st.openFailures?.length) {
        // A fix: the same tool succeeding at the same target soon after, or within the same request.
        const target = call?.metadata?.target ?? ''
        const i = st.openFailures.findLastIndex(f => f.tool === tool && ts - f.ts < 30 * 60e3 && ((target && f.target === target) || (f.req && f.req === call?.metadata?.parent)))
        if (i !== -1) {
          const f = mem.get(st.openFailures[i].id)
          if (f) {
            f.metadata.fixedBy = id
            f.metadata.fixes = (f.metadata.fixes ?? 0) + 1
            f.metadata.lastFixed = ts
            f.metadata.resolved = 1
            mem.link(f.id, id)
          }
          const fr = mem.get(st.openFailures[i].req)
          if (fr) fr.metadata.fixed++
          st.openFailures.splice(i, 1)
        }
      }
    }
    if (o.isMeta || o.toolUseResult) return made
    const images = blocks.filter(b => b.type === 'image').map(saveImage).filter(Boolean)
    await handleRequest(`u:${o.uuid}`, textOf(content), images)
    return made
  }

  if (o.type === 'assistant' && Array.isArray(content)) {
    const m = { who: who ?? 'claude', model: o.message?.model, effort: o.effort ?? o.perTurnEffort, parent: st.lastRequest }
    for (const [i, b] of content.entries()) {
      if (b.type === 'text' && b.text?.trim()) {
        const id = `a:${o.uuid}:${i}`
        const stopped = LIMIT_HIT.test(b.text) && b.text.length < 300
        if (!(await add('response', { id, text: clip(scrub(b.text), 3000), meta: { ...m, interrupted: stopped || undefined } }))) continue
        made++
        const r = req()
        if (stopped && r) r.metadata.interrupted = true
        if (r) { mem.link(r.id, id); r.metadata.answeredBy ??= id; r.metadata.lastAnswer = id }
        st.lastResponse = id
        // Images waiting for a description get what Claude said right after seeing them.
        for (const imId of st.pendingImages ?? []) {
          const im = mem.get(imId)
          if (im) await mem.pool('image').update(imId, { content: `${im.content} | Claude said next: ${clip(scrub(b.text), 280)}` })
        }
        st.pendingImages = []
      } else if (b.type === 'thinking' && b.thinking?.trim()) {
        if (await add('thinking', { id: `th:${o.uuid}:${i}`, text: clip(b.thinking.trim(), 1500), meta: m })) made++
      } else if (b.type === 'tool_use') {
        const id = `tu:${b.id}`
        if (await add('tool_call', { id, text: `${b.name}: ${summarizeInput(b.input)}`, meta: { ...m, tool: b.name, target: targetOf(b.input) } })) {
          made++
          const r = req()
          if (r) { r.metadata.calls++; mem.link(r.id, id) }
        }
      }
    }
  }
  return made
}

export const helperIdOf = file => basename(file, '.jsonl').replace(/^agent-/, '')
