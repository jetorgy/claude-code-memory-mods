// Applies Claude's explicit marks (mark.mjs) to the exchange they are about. Runs inside the
// indexer, after the turn's lines are saved, so the messages being marked already exist.
// An explicit mark is a real signal, so it is the one place besides a user correction that
// weakens memory (darkmind's rule: penalize only on a real "that was wrong").
import { readFileSync, existsSync } from 'node:fs'
import { MARKS_PATH, put } from './store.mjs'
import { reinforce, penalize } from './strength.mjs'

const byNewest = (a, b) => b.metadata.ts - a.metadata.ts
let ctxState = null

async function feedback(mem, req, ensureActive, kind) {
  if (!req) return
  const flag = kind === 'wrong' ? 'penalized' : 'confirmedReinforced'
  if (req.metadata[flag]) return // never count the same exchange twice
  req.metadata[flag] = true
  for (const id of req.metadata.retrieved ?? []) {
    if (!(await ensureActive(id))) continue
    const n = mem.get(id)
    kind === 'wrong' ? penalize(n.metadata) : reinforce(n.metadata)
  }
}

async function applyOne(mem, mk, ensureActive) {
  const inSession = p => mem.pool(p).list().filter(n => n.metadata.session === mk.session && !n.metadata.helper)
  // The message the user just sent (the one Claude was answering when it made the mark)...
  const cur = [...inSession('request'), ...inSession('correction')].filter(n => n.metadata.ts <= mk.ts + 5000).sort(byNewest)[0]
  if (!cur) return Date.now() - mk.ts < 10 * 60e3 ? 'wait' : 'skip'
  // ...and the answer the user was reacting to, with the request it answered.
  const prevAns = inSession('response').filter(n => n.metadata.ts < cur.metadata.ts).sort(byNewest)[0] ?? null
  const prevReq = prevAns ? mem.get(prevAns.metadata.parent) : null

  if (mk.kind === 'wrong_answer' || mk.kind === 'frustrated') {
    let corr = cur
    if (cur.pool === 'request') {
      // The user's message becomes a correction memory: a lesson from a wrong answer.
      const { id, content, metadata } = cur
      mem.pool('request').remove(id)
      corr = await mem.pool('correction').create({ id, content, metadata: { ...metadata, corrects: prevAns?.id ?? null } })
      mem.link(id, `s:${mk.session}`)
    }
    corr.metadata.markedBy = 'claude'
    if (mk.note) corr.metadata.note = mk.note
    if (prevAns) {
      prevAns.metadata.outcome = 'corrected'
      prevAns.metadata.correctedBy ??= corr.id
      prevAns.metadata.explicitWrong = true
      corr.metadata.corrects ??= prevAns.id
      mem.link(corr.id, prevAns.id)
    }
    if (mk.kind === 'frustrated') { corr.metadata.frustrated = true; corr.metadata.priority = 2; reinforce(corr.metadata) }
    if (prevReq) prevReq.metadata.outcome = 'corrected'
    await feedback(mem, prevReq, ensureActive, 'wrong')
  } else if (mk.kind === 'worked') {
    if (prevAns) prevAns.metadata.outcome = 'confirmed'
    if (prevReq) { prevReq.metadata.outcome = 'confirmed'; reinforce(prevReq.metadata) }
    if (prevAns) reinforce(prevAns.metadata)
    await feedback(mem, prevReq, ensureActive, 'right')
  } else if (mk.kind === 'important') {
    for (const n of mk.target === 'current' ? [cur] : [prevReq, prevAns]) {
      if (!n) continue
      n.metadata.priority = 2 // fades half as fast
      n.metadata.important = true
      if (mk.note) n.metadata.note = mk.note
      reinforce(n.metadata)
    }
  } else if (mk.kind === 'lesson') {
    const id = `l:${mk.session}:${mk.ts}`
    const m = cur.metadata
    const node = await put(mem, 'lesson', { id, content: mk.note, metadata: { who: 'claude', session: mk.session, project: m.project, grp: m.grp, cwd: m.cwd, ts: mk.ts, from: cur.id, priority: 3, strength: 0.6, lastTouched: mk.ts } })
    if (node) { mem.link(id, cur.id); mem.link(id, `s:${mk.session}`) }
    // A lesson researched for an error is attached to that error's memory.
    const failureId = mk.sig ? ctxState?.sigs?.[mk.sig] : null
    if (node && failureId && (await ensureActive(failureId))) {
      const f = mem.get(failureId)
      f.metadata.lesson = id
      node.metadata.sig = mk.sig
      mem.link(failureId, id)
    }
  }
  return 'done'
}

export async function applyMarks({ mem, state, ensureActive }) {
  ctxState = state
  if (!existsSync(MARKS_PATH)) return 0
  const lines = readFileSync(MARKS_PATH, 'utf8').split('\n').filter(Boolean)
  let done = state.marksDone ?? 0, applied = 0
  for (; done < lines.length; done++) {
    let mk
    try { mk = JSON.parse(lines[done]) } catch { continue }
    const r = await applyOne(mem, mk, ensureActive)
    if (r === 'wait') break // that turn is not saved yet; tried again on the next run
    if (r === 'done') applied++
  }
  state.marksDone = done
  return applied
}
