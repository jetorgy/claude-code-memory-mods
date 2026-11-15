#!/usr/bin/env node
// Finds past work relevant to a question with Liminal's own ranking, weighted by how established
// each memory is (strength.mjs). Active memory is searched first, cold storage as a second tier.
// From each hit it follows strong, relevant links a few steps out (bridges). On the first message
// of a new session it also hands off: the last messages, still-open errors, and lessons.
// It records what it showed so the indexer can learn from how that turn went.
//   node recall.mjs --q "text" [--cwd /path] [--session ID] [--record] [--handoff] [--json]
//                   [--limit N] [--scope all|project]
// Prints a <session-memory> block, or nothing when there is nothing to hand over.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractKeywords, stem } from '@automacene/liminal-memory'
import { indexAll } from './index.mjs'
import { HOME, openMemory, openCold, loadConfig, existsMemory, lookup, loadCorrections, refOf, isSwitchTalk, RECALLS_PATH, COLD_PATH } from './store.mjs'
import { placeOf, HARNESS_ERROR } from './parse.mjs'
import { strengthOf } from './strength.mjs'
import { embedQuery, nearest, cosOf } from './embed.mjs'

const day = ts => new Date(ts).toISOString().slice(0, 10)
const one = s => (s || '').replace(/\s+/g, ' ').trim()
const clip = (s, n) => (one(s).length > n ? `${one(s).slice(0, n)}…` : one(s))
const body = n => (n?.content ?? '').toString()
const after = s => s.replace(/^[^:]*: /, '')
const stems = t => new Set(extractKeywords(t).map(stem))
const share = (qs, n) => (qs.length ? qs.filter(t => stems(body(n)).has(t)).length / qs.length : 0)
// Everyday words that say nothing about the topic ("try it live with a blender call"): they can
// never be what makes a memory match, so they are ignored when deciding whether it does.
const GENERIC = new Set(['try', 'tri', 'live', 'call', 'tell', 'show', 'look', 'check', 'thing', 'stuff', 'work', 'working', 'want', 'need', 'make', 'doe', 'doing', 'going', 'actual', 'actually', 'real', 'really', 'someth', 'anyth', 'everyth', 'right', 'good', 'help', 'start', 'use', 'using', 'run', 'running', 'test', 'tested', 'first', 'last', 'back', 'again', 'still', 'much', 'many', 'quick', 'real', 'time', 'way', 'let', 'get', 'got', 'give', 'take', 'put', 'see', 'seen', 'know', 'think', 'mean', 'sure', 'okay', 'yeah', 'just', 'like', 'also', 'even', 'new', 'old', 'one', 'two'])
// Corrections Claude made on the spot (correct.mjs): a forgotten memory is never shown; a corrected
// one shows the corrected text. Read once per process, which is one lookup.
let CORR = null
const corrs = () => (CORR ??= loadCorrections())
const forgotten = id => Boolean(corrs()[id]?.forget)
const fixedText = id => corrs()[id]?.fix ?? null
const BRIDGE_MIN = 0.2 // a link is followed only if strength and relevance together clear this

function outcomeLine(req) {
  const m = req.metadata
  const parts = []
  if (m.calls) parts.push(`${m.calls} tool call${m.calls === 1 ? '' : 's'}`)
  if (m.failures) parts.push(`${m.failures} failed`)
  if (m.fixed) parts.push(`${m.fixed} fixed`)
  if (m.interrupted) parts.push('stopped by a usage limit before finishing')
  parts.push(m.outcome === 'corrected' ? 'the user said the result was wrong' : m.outcome === 'confirmed' ? 'the user confirmed it worked' : 'no correction from the user')
  return `Outcome: ${parts.join(', ')}`
}

function failureLines(get, f) {
  const m = f.metadata
  const call = get(m.parent)
  const own = fixedText(f.id)
  const fix = own || forgotten(m.fixedBy) ? null : get(m.fixedBy)
  const times = (m.count ?? 1) > 1 ? ` ${m.count} times, last on ${day(m.lastSeen ?? m.ts)}` : ''
  const lines = [`Tried: ${clip(body(call) || m.tool || '', 110)}`, `FAILED${times}: ${clip(after(body(f)), 140)}`]
  if (own) {
    lines.push(`Corrected fix (set by Claude, replaces the earlier one): ${clip(own, 220)}`)
  } else if (fix) {
    lines.push(`Fixed${(m.fixes ?? 1) > 1 ? ` ${m.fixes} times` : ''} by: ${clip(body(get(fix.metadata.parent)) || '', 100)} → ${clip(after(body(fix)), 80)}`)
    if (m.lastFixed && (m.lastSeen ?? m.ts) <= m.lastFixed) lines.push('Has not happened again since the last fix: looks learned.')
  } else if (!m.lesson || forgotten(m.lesson)) lines.push((m.count ?? 1) > 1 ? 'Never fixed: this keeps happening.' : 'No fix was recorded.')
  const lesson = get(m.lesson)
  if (lesson && !forgotten(lesson.id)) lines.push(`Researched fix (lesson): ${clip(fixedText(lesson.id) ?? body(lesson), 200)}`)
  return lines
}

// Bridges: from a hit, follow its links (graph edges plus the recorded relations) up to two steps,
// keeping only nodes that are both strong and relevant to the question, like darkmind's pathing.
function bridges(mem, get, start, qs, shown) {
  const found = []
  const seen = new Set([start.id, ...shown])
  let frontier = [start]
  for (let hop = 1; hop <= 2 && frontier.length; hop++) {
    const next = []
    for (const n of frontier) {
      let edges = []
      try { edges = mem.has(n.id) ? mem.neighbors(n.id).map(e => e.id) : [] } catch {}
      const m = n.metadata
      for (const id of [...edges, m.fixedBy, m.correctedBy, m.corrects, m.answeredBy, m.lastAnswer, m.request, m.parent, ...(m.retrieved ?? [])]) {
        if (!id || seen.has(id)) continue
        seen.add(id)
        const x = get(id)
        if (!x?.content || forgotten(x.id) || !['lesson', 'request', 'correction', 'failure', 'response'].includes(x.pool)) continue
        const score = (0.5 + strengthOf(x.metadata)) * share(qs, x)
        if (score >= BRIDGE_MIN) { found.push({ x, score, hop }); next.push(x) }
      }
    }
    frontier = next.sort((a, b) => strengthOf(b.metadata) - strengthOf(a.metadata)).slice(0, 4)
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 1)
}

function readCut() { try { return JSON.parse(readFileSync(join(HOME, 'window-cut.json'), 'utf8')) } catch { return {} } }

// The meaning side (embed.mjs), or null when it is off, the local model is not running, or nothing is embedded yet.
async function semanticSide(q, cfg) {
  if (cfg.semantic === false || cfg.embeddings === false) return null
  try {
    const qv = await embedQuery(q, { cfg, timeoutMs: 1500 })
    const top = qv ? nearest(qv, cfg, 40) : []
    return top.length ? { top, cosOf: id => cosOf(qv, id, cfg) } : null
  } catch { return null }
}

async function searchTier(store, cfg, q, qs, need, session, here, now, tier, sem) {
  const out = []
  const cut = readCut()
  const semMin = cfg.semMin ?? 0.7 // cosine at which a memory counts as the same meaning (nomic: unrelated tops out near 0.65)
  for (const pool of cfg.recallPools) {
    // minScore is Liminal's own 0..1 gate: a real match is near 0.9, incidental overlap near 0.25.
    const hits = await store.pool(pool).rank(q, { limit: 15, minScore: cfg.minScore })
    const cands = hits.map(({ node, score }) => ({ node, score }))
    // Memories that mean the same thing in other words: found by meaning alone (keyword score 0).
    if (sem) {
      const have = new Set(cands.map(c => c.node.id))
      for (const { id, cos } of sem.top) {
        if (cos < semMin) break
        if (have.has(id) || !store.has(id)) continue
        const node = store.get(id)
        if (node.pool === pool) cands.push({ node, score: 0 })
      }
    }
    for (const { node, score } of cands) {
      const m = node.metadata
      const cos = sem ? sem.cosOf(node.id) : null
      const meaning = cos !== null && cos >= semMin
      if (forgotten(node.id)) continue // Claude corrected memory: this one is not to be shown
      if (isSwitchTalk(body(node))) continue // talk of switching the memory on/off is never recalled
      // This conversation is already in front of the model, except what a compaction pushed out of view
      // (older than the active window's first pair): that is recalled like any other memory.
      if (session && m.session === session && !(cut.session === session && cut.ts && m.ts && m.ts < cut.ts)) continue
      if (pool === 'failure' && HARNESS_ERROR.test(body(node))) continue // a permission outage is not a failure worth recalling
      // A keyword match must share the question's words; one that matches in meaning needs no shared words.
      if (!meaning && qs.filter(t => stems(body(node)).has(t)).length < need) continue
      // Meaning can only add to a keyword match, never lower it (a keyword hit with an unrelated-looking
      // vector keeps its score). A meaning-only find starts at 0.77 (cosine 0.70) and tops out at 0.9.
      const sc = cos === null ? 0 : Math.max(0, Math.min(1, (cos - 0.5) / 0.3))
      const base = score >= cfg.minScore ? 1 - (1 - score) * (1 - 0.6 * sc) : 0.5 + 0.4 * sc
      let s = base * (0.8 + 0.4 * strengthOf(m, now)) // learned: used memories rise, penalized ones sink
      if ((m.project || '').toLowerCase() === here) s *= 1.15
      else if (cfg.scope === 'project') continue
      if (pool === 'failure' && m.fixedBy) s *= 1.15
      if (pool === 'failure' && (m.count ?? 1) > 1) s *= 1 + Math.min(0.3, 0.05 * m.count) // keeps happening
      if (pool === 'correction' || m.outcome === 'corrected') s *= 1.1 // a lesson from a wrong answer
      if (tier === 'cold') s *= 0.9
      out.push({ node, s, tier })
    }
  }
  return out
}

// Ids already shown in this session (messages and tool calls alike): never shown twice.
export function shownIn(session) {
  const ids = new Set()
  if (!session || !existsSync(RECALLS_PATH)) return ids
  for (const line of readFileSync(RECALLS_PATH, 'utf8').split('\n')) {
    if (!line.includes(`"session":"${session}"`)) continue
    try { const r = JSON.parse(line); for (const id of [...(r.ids ?? []), ...(r.handoffIds ?? [])]) ids.add(id) } catch {}
  }
  return ids
}

export async function recall({ mem, q, cwd = '', session = '', limit, cfg, skip = new Set() }) {
  if (!q.trim()) return { items: [], cold: null }
  const here = cwd ? placeOf(cwd, cfg.groups).project.toLowerCase() : ''
  const qs = [...stems(q)].filter(t => !GENERIC.has(t))
  if (qs.length === 0) return { items: [], cold: null } // nothing but everyday words: nothing to match on
  // A real match shares at least half of the question's words (all of them for a short question).
  const need = qs.length >= 4 ? Math.ceil(qs.length * (cfg.minShare ?? 0.5)) : qs.length
  const now = Date.now()
  const max = limit ?? cfg.maxResults
  const sem = await semanticSide(q, cfg)
  let scored = await searchTier(mem, cfg, q, qs, need, session, here, now, 'active', sem)
  // Cold storage is the second tier: searched when active memory did not fill the answer.
  let cold = null
  if (scored.length < max && existsSync(COLD_PATH)) {
    cold = openCold()
    scored = scored.concat(await searchTier(cold, cfg, q, qs, need, session, here, now, 'cold', sem))
  }
  const get = lookup(mem, cold)
  scored.sort((a, b) => b.s - a.s || a.node.id.localeCompare(b.node.id))

  const items = [], used = new Set()
  for (const { node: hit, tier } of scored) {
    const m = hit.metadata
    if (skip.has(hit.id)) continue
    let lines, why = '', ids, main = hit
    if (hit.pool === 'failure') {
      if (used.has(hit.id)) continue
      used.add(hit.id)
      const req = get(m.request)
      if (req) why = `while working on: "${clip(body(req), 80)}"`
      lines = failureLines(get, hit)
      ids = [hit.id, ...(m.fixedBy ? [m.fixedBy] : [])]
    } else if (hit.pool === 'lesson') {
      if (used.has(hit.id)) continue
      used.add(hit.id)
      lines = [`Lesson${fixedText(hit.id) ? ' (corrected)' : ''}: ${clip(fixedText(hit.id) ?? body(hit), 260)}`]
      const from = get(m.from)
      if (from) lines.push(`Learned while: "${clip(body(from), 80)}"`)
      ids = [hit.id]
    } else if (hit.pool === 'image') {
      if (used.has(hit.id)) continue
      used.add(hit.id)
      lines = [`Image: ${clip(body(hit), 160)}`, `File: ${m.image}`]
      ids = [hit.id]
    } else {
      // request, correction, response and thinking all resolve to the exchange they belong to.
      const req = hit.pool === 'request' || hit.pool === 'correction' ? hit : get(m.parent)
      if (!req || used.has(req.id) || skip.has(req.id)) continue
      used.add(req.id)
      main = req
      const ans = get(req.metadata.answeredBy)
      const last = get(req.metadata.lastAnswer)
      lines = [`Asked: ${clip(body(req), 130)}`]
      if (req.pool === 'correction') {
        const wrong = get(req.metadata.corrects)
        if (wrong) lines.unshift(`Earlier answer the user called wrong: ${clip(body(wrong), 110)}`)
        if (req.metadata.frustrated) lines.push('The user was frustrated here.')
        if (req.metadata.note) lines.push(`What went wrong: ${clip(req.metadata.note, 140)}`)
      }
      if (req.metadata.important) lines.push(`Marked important${req.metadata.note && req.pool !== 'correction' ? `: ${clip(req.metadata.note, 160)}` : ''}.`)
      if (ans) lines.push(`Answer: ${clip(body(ans), 130)}`)
      if (last && last.id !== ans?.id) lines.push(`Ended with: ${clip(body(last), 130)}`)
      if (hit.pool === 'thinking') lines.push(`Reasoning then: ${clip(body(hit), 110)}`)
      if (ans?.metadata?.outcome === 'corrected' || req.metadata.outcome === 'corrected') {
        const fixReq = get((ans ?? last)?.metadata?.correctedBy)
        if (fixReq) lines.push(`The user then said it was wrong: "${clip(body(fixReq), 110)}"`)
        const better = get(fixReq?.metadata?.lastAnswer)
        if (better) lines.push(`After that correction: ${clip(body(better), 120)}`)
      }
      lines.push(outcomeLine(req))
      ids = [req.id, hit.id].filter((v, i, a) => a.indexOf(v) === i)
    }
    for (const { x, hop } of bridges(mem, get, main, qs, used)) {
      used.add(x.id)
      const label = x.pool === 'failure' ? `failure seen ${x.metadata.count ?? 1}×` : x.pool
      lines.push(`Linked (${label}, ${x.metadata.project}): ${clip(body(x), 100)}`)
      ids.push(x.id)
    }
    // The whole item, not only the hit: a clean hit can still carry the question, answer or link that mentions it.
    if (isSwitchTalk([body(hit), body(main), ...lines].join('\n'))) continue
    const s = get(`s:${m.session}`)
    items.push({ r: hit, why, lines, ids, title: s?.metadata?.title ?? null, tier })
    if (items.length >= max) break
  }
  return { items, cold }
}

// Has this session already been handed its handoff? (Also true for a resumed session.)
function alreadyHandedOff(mem, session) {
  if (mem.has(`s:${session}`)) return true
  if (!existsSync(RECALLS_PATH)) return false
  return readFileSync(RECALLS_PATH, 'utf8').split('\n').some(l => l.includes(`"session":"${session}"`) && l.includes('"handoff":true'))
}

// The handoff for a new session: what was said last, what is still broken, what was learned.
// Draws on active memory and cold storage both: the last messages are the last messages, however
// faded they are.
export function handoff({ mem, cold, session, cwd, cfg }) {
  const here = cwd ? placeOf(cwd, cfg.groups).project.toLowerCase() : ''
  const now = Date.now()
  const sections = [], ids = []
  const get = lookup(mem, cold)
  const all = p => [...mem.pool(p).list(), ...(cold ? cold.pool(p).list() : [])]
  const title = id => get(`s:${id}`)?.metadata?.title
  const asked = [...all('request'), ...all('correction')]
    .filter(n => n.metadata.session !== session && !n.metadata.helper)
    .filter(n => !isSwitchTalk(`${body(n)}\n${body(get(n.metadata.lastAnswer) ?? get(n.metadata.answeredBy))}`))
    .sort((a, b) => b.metadata.ts - a.metadata.ts)
    .slice(0, cfg.handoffMessages)
    .reverse()
  if (asked.length) {
    const lines = asked.map(n => {
      const ans = get(n.metadata.lastAnswer) ?? get(n.metadata.answeredBy)
      ids.push(n.id)
      const t = title(n.metadata.session)
      return `- [${day(n.metadata.ts)} · ${n.metadata.project}${t ? ` · "${clip(t, 24)}"` : ''}] User: ${clip(body(n), 80)}${ans ? ` → Claude: ${clip(body(ans), 70)}` : ''}${n.metadata.interrupted ? ' (STOPPED by a usage limit)' : ''}`
    })
    sections.push(`Most recent messages from earlier sessions (oldest first):\n${lines.join('\n')}`)
  }
  const lessonText = all('lesson').filter(l => !forgotten(l.id) && !isSwitchTalk(body(l))).map(l => body(l))
  const open = all('failure')
    .filter(f => (f.metadata.count ?? 1) > 1 && !(f.metadata.lastFixed && (f.metadata.lastSeen ?? f.metadata.ts) <= f.metadata.lastFixed))
    .filter(f => !HARNESS_ERROR.test(body(f)) && !isSwitchTalk(body(f))) // a permission prompt is not a real error
    .filter(f => !f.metadata.lesson && !lessonText.some(t => f.metadata.tool && t.includes(f.metadata.tool))) // already has a saved lesson
    .sort((a, b) => ((b.metadata.project || '').toLowerCase() === here) - ((a.metadata.project || '').toLowerCase() === here) || strengthOf(b.metadata, now) - strengthOf(a.metadata, now))
    .slice(0, 3)
  if (open.length) {
    sections.push(`Errors that keep happening and are not solved yet:\n${open.map(f => {
      ids.push(f.id)
      return `- ${f.metadata.tool} failed ${f.metadata.count}×, last ${day(f.metadata.lastSeen ?? f.metadata.ts)} in ${f.metadata.project}: ${clip(after(body(f)), 100)}`
    }).join('\n')}`)
  }
  const saved = all('lesson').filter(l => !forgotten(l.id) && !isSwitchTalk(body(l))).sort((a, b) => ((b.metadata.project || '').toLowerCase() === here) - ((a.metadata.project || '').toLowerCase() === here) || strengthOf(b.metadata, now) - strengthOf(a.metadata, now)).slice(0, 4)
  if (saved.length) sections.push(`Lessons saved earlier:\n${saved.map(l => { ids.push(l.id); return `- [${l.metadata.project}] ${clip(fixedText(l.id) ?? body(l), 160)} (ref ${refOf(l.id)})` }).join('\n')}`)
  const lessons = all('correction')
    .filter(c => now - c.metadata.ts < 30 * 864e5 && !isSwitchTalk(body(c)))
    .sort((a, b) => ((b.metadata.project || '').toLowerCase() === here) - ((a.metadata.project || '').toLowerCase() === here) || b.metadata.ts - a.metadata.ts)
    .slice(0, 2)
  if (lessons.length) {
    sections.push(`Recent lessons (the user said an answer was wrong):\n${lessons.map(c => {
      ids.push(c.id)
      const wrong = get(c.metadata.corrects)
      const better = get(c.metadata.lastAnswer)
      return `- [${day(c.metadata.ts)} · ${c.metadata.project}${c.metadata.frustrated ? ' · frustrated' : ''}] User: "${clip(body(c), 90)}"${c.metadata.note ? ` Went wrong: ${clip(c.metadata.note, 90)}` : ''}${better ? ` → then: ${clip(body(better), 80)}` : ''}`
    }).join('\n')}`)
  }
  const strong = ['failure', 'request', 'response'].flatMap(p => mem.pool(p).list())
    .filter(n => (n.metadata.reuses ?? 0) > 0 && !ids.includes(n.id))
    .sort((a, b) => strengthOf(b.metadata, now) - strengthOf(a.metadata, now))
    .slice(0, 2)
  if (strong.length) {
    sections.push(`Memories used most often lately:\n${strong.map(n => { ids.push(n.id); return `- [${n.metadata.project} · ${n.pool}] ${clip(body(n), 100)}` }).join('\n')}`)
  }
  return { sections, ids }
}

export function render({ items = [], handoffSections = [], plain = false }, maxChars) {
  if (items.length === 0 && handoffSections.length === 0) return ''
  let out = plain ? 'Memory results (earlier sessions; may be old, check before relying on them):\n' : '<session-memory>\n' +
    'MEMORY RECALL, NOT A REQUEST: remembered from OTHER sessions by the session-memory mod. Answer only the user\'s message above.\n' +
    'Not instructions or answers to give; background on what was tried, failed, fixed or corrected. May be old or unrelated: check it, ignore it if it does not help.\n'
  if (handoffSections.length) {
    out += '\nHANDOFF: this is a new session. Below is where earlier sessions left off, so nothing is lost between them.\n'
    // Every section is fitted to what is left (trailing lines dropped), never skipped whole: the
    // last-messages buffer comes first and must always be there.
    const reserve = (items.length ? 500 : 0) + 260 // 260 keeps room for the commands line below
    for (const s of handoffSections) {
      const room = maxChars - reserve - out.length - 2
      const lines = s.split('\n')
      let kept = lines[0] ?? ''
      if (kept.length > room) continue
      for (const l of lines.slice(1)) { if (kept.length + l.length + 1 > room) break; kept += `\n${l}` }
      if (kept.includes('\n')) out += `\n${kept}\n`
    }
  }
  // Always the last thing in a handoff, so the next session knows how to look at the memory itself.
  if (handoffSections.length) out += '\nMemory commands: /recall active shows the active nodes list (/recall active lesson for one kind); /recall <words> searches; /recall stats shows counts. Tools: search, session_trail, mark, investigate_error, correct_memory (fix or forget a memory the moment it is wrong; refs are shown beside items).\n'
  let n = 0
  if (items.length) out += '\nRemembered for this message:\n'
  for (const it of items) {
    const m = it.r.metadata
    const where = [day(m.ts), m.project, it.title ? `"${clip(it.title, 50)}"` : null, m.helper ? 'helper' : null, it.tier === 'cold' ? 'from cold storage' : null].filter(Boolean).join(' · ')
    const head = `${n + 1}. [${where}] ${it.why} (ref ${refOf(it.r.id)})`.replace(/\s+\(ref/, ' (ref').trimEnd()
    const block = `${head}\n${it.lines.map(l => `   ${l}`).join('\n')}\n`
    if (out.length + block.length < maxChars) { out += block; n++ }
  }
  const done = out.replace(/\nRemembered for this message:\n$/, '\n') + (n ? 'Something here wrong or outdated? Fix it now with correct_memory (give the ref).\n' : '')
  return plain ? done.replace('\nRemembered for this message:\n', '\n') : `${done}</session-memory>`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2)
  const arg = k => { const i = a.indexOf(k); return i === -1 ? undefined : a[i + 1] }
  if (!existsMemory()) process.exit(0)
  const cfg = loadConfig()
  if (arg('--scope')) cfg.scope = arg('--scope')
  if (arg('--kinds')) cfg.recallPools = arg('--kinds').split(',').filter(k => cfg.recallPools.includes(k) || k === 'success' || k === 'tool_call')
  let mem = openMemory()
  const q = arg('--q') || ''
  const session = arg('--session') || ''
  const cwd = arg('--cwd') || ''
  // Is this the first message of a new session? Decided before anything is read, because reading
  // this session's own transcript would create its node and make it look like a resumed one.
  const wantHandoff = a.includes('--handoff') && Boolean(session) && !alreadyHandedOff(mem, session)
  // The session just left may have ended seconds ago: read its newest messages in first (a quick
  // incremental read; skipped if another read is already running).
  if (wantHandoff) { try { await indexAll() } catch {} ; mem = openMemory() }
  const { items, cold } = await recall({ mem, q, cwd, session, limit: arg('--limit') ? +arg('--limit') : undefined, cfg, skip: shownIn(session) })
  const isHandoff = wantHandoff
  const h = isHandoff ? handoff({ mem, cold: cold ?? (existsSync(COLD_PATH) ? openCold() : null), session, cwd, cfg }) : { sections: [], ids: [] }
  const text = render({ items, handoffSections: h.sections, plain: a.includes('--plain') }, isHandoff ? cfg.handoffMaxChars : a.includes('--plain') ? 2200 : cfg.maxChars)
  // The learning record: which memory was attached to which prompt in which session.
  if (a.includes('--record') && text && session) {
    appendFileSync(RECALLS_PATH, `${JSON.stringify({ session, ts: Date.now(), q: q.trim().slice(0, 200), ids: items.flatMap(i => i.ids), ...(isHandoff ? { handoff: true, handoffIds: h.ids } : {}) })}\n`, { mode: 0o600 })
  }
  if (a.includes('--json')) console.log(JSON.stringify({ handoff: h.sections, items: items.map(i => ({ ids: i.ids, pool: i.r.pool, tier: i.tier, project: i.r.metadata.project, title: i.title, day: day(i.r.metadata.ts), lines: i.lines })) }))
  else if (text) console.log(text)
}
