#!/usr/bin/env node
// The paper trail of a past session: what was asked, what was answered, what failed, what fixed
// it, what the user corrected. Finds the session by words from its title, its project, or its id.
//   node trail.mjs --q "words or session id" [--cwd /path] [--session CURRENT_ID]
import { existsSync } from 'node:fs'
import { extractKeywords, stem } from '@automacene/liminal-memory'
import { openMemory, openCold, existsMemory, lookup, isSwitchTalk, COLD_PATH } from './store.mjs'

const when = ts => (ts ? new Date(ts).toISOString().slice(0, 16).replace('T', ' ') : '?')
const one = s => (s || '').replace(/\s+/g, ' ').trim()
const clip = (s, n) => (one(s).length > n ? `${one(s).slice(0, n)}…` : one(s))
const body = n => (n?.content ?? '').toString()
const stems = t => new Set(extractKeywords(t).map(stem))

export function findSessions(mem, q, current) {
  const qs = [...stems(q)]
  const sessions = mem.pool('session').list().filter(s => s.metadata.session !== current)
  const scored = sessions.map(s => {
    const m = s.metadata
    if (q && m.session.startsWith(q.trim())) return { s, score: 2 }
    const projects = mem.neighbors(s.id).map(e => e.id).filter(id => id.startsWith('p:')).join(' ')
    const words = stems(`${m.title ?? ''} ${projects.replace(/[p:/_-]+/g, ' ')}`)
    const score = qs.length ? qs.filter(t => words.has(t)).length / qs.length : 0
    return { s, score }
  })
  const hits = q ? scored.filter(x => x.score > 0) : scored
  return hits.sort((a, b) => b.score - a.score || (b.s.metadata.lastTs ?? 0) - (a.s.metadata.lastTs ?? 0)).map(x => x.s)
}

// A compact summary, not a transcript: whatever a tool returns stays in the conversation and is
// re-sent every turn, so this gives the shape of the session and points to search for details.
export function trailOf(mem, cold, session) {
  const get = lookup(mem, cold)
  const all = p => [...mem.pool(p).list(), ...(cold ? cold.pool(p).list() : [])].filter(n => n.metadata.session === session && !n.metadata.helper)
  const s = get(`s:${session}`)
  const reqs = [...all('request'), ...all('correction')].sort((a, b) => a.metadata.ts - b.metadata.ts)
  const sum = k => reqs.reduce((n, r) => n + (r.metadata[k] || 0), 0)
  const corrections = reqs.filter(r => r.pool === 'correction')
  const stops = reqs.filter(r => r.metadata.interrupted)
  const unfixed = [...mem.pool('failure').list(), ...(cold ? cold.pool('failure').list() : [])]
    .filter(f => f.metadata.session === session && !f.metadata.fixedBy && !f.metadata.lesson)
  const first = reqs[0], last = reqs[reqs.length - 1]
  const lastAns = last ? get(last.metadata.lastAnswer) ?? get(last.metadata.answeredBy) : null
  const lines = [
    `"${s?.metadata?.title ?? session}" (${session}) ${when(s?.metadata?.firstTs)} → ${when(s?.metadata?.lastTs)}: ${reqs.length} messages, ${sum('calls')} tool calls, ${sum('failures')} failed, ${sum('fixed')} fixed, ${corrections.length} corrections, ${stops.length} usage-limit stops.`,
  ]
  if (first) lines.push(`Started: ${clip(body(first), 140)}`)
  if (last && last !== first) lines.push(`Ended: ${clip(body(last), 110)}${lastAns ? ` → ${clip(body(lastAns), 110)}` : ''}${last.metadata.interrupted ? ' (STOPPED by a usage limit, unfinished)' : ''}`)
  for (const c of corrections.slice(-3)) lines.push(`Corrected${c.metadata.frustrated ? ' (frustrated)' : ''}: ${clip(body(c), 100)}`)
  for (const f of unfixed.slice(0, 2)) lines.push(`Unfixed: ${clip(body(f).replace(/^[^:]*: /, ''), 100)}`)
  for (const l of all('lesson').slice(0, 3)) lines.push(`Lesson: ${clip(body(l), 140)}`)
  lines.push('For details on any part, use the search tool with words from it.')
  // Talk of switching the memory on/off is never shown (the summary line stays).
  return lines.filter((l, i) => i === 0 || !isSwitchTalk(l)).join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2)
  const arg = k => { const i = a.indexOf(k); return i === -1 ? undefined : a[i + 1] }
  if (!existsMemory()) { console.log('The memory is empty so far.'); process.exit(0) }
  const mem = openMemory()
  const q = (arg('--q') || '').trim()
  const found = findSessions(mem, q, arg('--session') || '')
  if (found.length === 0) { console.log(`No session matches "${q}".`); process.exit(0) }
  // One clear session (an id, or the only match) gets its trail; otherwise a list to pick from.
  const byId = q.length >= 8 && found[0].metadata.session.startsWith(q)
  if (q && (byId || found.length === 1)) {
    console.log(trailOf(mem, existsSync(COLD_PATH) ? openCold() : null, found[0].metadata.session))
  } else {
    console.log(`${q ? `Sessions matching "${q}"` : 'Most recent sessions'} (call again with a session id to see its trail):`)
    for (const s of found.slice(0, 10)) console.log(`- ${s.metadata.session} · ${when(s.metadata.lastTs)} · ${s.metadata.title ?? '(untitled)'}`)
  }
}
