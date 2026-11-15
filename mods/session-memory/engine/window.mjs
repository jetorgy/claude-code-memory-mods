#!/usr/bin/env node
// The active window: the last N whole user/Claude pairs of THIS session, never clipped, shown on the
// first message after a compaction only (the live conversation is the window the rest of the time).
// N tunes itself the way the author tuned Liminal: if compactions come faster than the recent average the
// window is eating the room, so it loses pairs; if they come slower it may gain one. If the whole
// pairs would exceed the budget, the oldest whole pairs are dropped, never clipped.
//   node window.mjs --count                  one more turn since the last compaction
//   node window.mjs --session ID             tune once, then print the window
//   node window.mjs --status                 print the tuner state
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { openMemory, existsMemory, isSwitchTalk, HOME } from './store.mjs'

const STATE = join(HOME, 'window-state.json')
const START_PAIRS = 40, MIN_PAIRS = 10, MAX_PAIRS = 80
const BUDGET_CHARS = 120000 // about 30k tokens: a hard ceiling, a fifth of the 150k compaction point
const load = () => { try { return { pairs: START_PAIRS, turnsSince: 0, intervals: [], ...JSON.parse(readFileSync(STATE, 'utf8')) } } catch { return { pairs: START_PAIRS, turnsSince: 0, intervals: [] } } }
const save = s => { const t = `${STATE}.${process.pid}.tmp`; writeFileSync(t, JSON.stringify(s)); renameSync(t, STATE) }
const a = process.argv.slice(2)
const arg = k => { const i = a.indexOf(k); return i === -1 ? undefined : a[i + 1] }

if (a.includes('--count')) { const s = load(); s.turnsSince++; save(s); process.exit(0) }
if (a.includes('--status')) { console.log(JSON.stringify(load())); process.exit(0) }

const session = arg('--session') || ''
if (!session || !existsMemory()) process.exit(0)

// Tune once per compaction (this is called once per compaction).
const s = load()
const interval = s.turnsSince
if (interval > 0) {
  const recent = s.intervals.slice(-3)
  if (recent.length > 0) {
    const avg = recent.reduce((x, y) => x + y, 0) / recent.length
    if (interval < avg * 0.75) s.pairs = Math.max(MIN_PAIRS, s.pairs - 2) // compacting more often: shrink
    else if (interval > avg * 1.33) s.pairs = Math.min(MAX_PAIRS, s.pairs + 1) // room to spare: grow slowly
  }
  s.intervals = [...s.intervals, interval].slice(-8)
}
s.turnsSince = 0
save(s)

const mem = openMemory()
// A pair that is only talk of switching the memory on/off is left out of the window (never replayed).
const answerOf = r => (r.metadata.lastAnswer ? mem.get(r.metadata.lastAnswer) : r.metadata.answeredBy ? mem.get(r.metadata.answeredBy) : null)
const reqs = mem.pool('request').list().filter(n => n.metadata.session === session && !isSwitchTalk(`${n.content ?? ''}\n${answerOf(n)?.content ?? ''}`)).sort((x, y) => (y.metadata.ts || 0) - (x.metadata.ts || 0)).slice(0, s.pairs).reverse()
if (reqs.length === 0) process.exit(0)
const pairs = reqs.map(r => {
  const ans = r.metadata.lastAnswer ? mem.get(r.metadata.lastAnswer) : r.metadata.answeredBy ? mem.get(r.metadata.answeredBy) : null
  return `User: ${(r.content || '').trim()}${ans ? `\nClaude: ${(ans.content || '').trim()}` : ''}`
})
while (pairs.length > 1 && pairs.join('\n\n').length > BUDGET_CHARS) pairs.shift() // whole pairs only
// Tell recall where the window starts: this session's memories older than that are NOT in front of the model.
try {
  const first = reqs[reqs.length - pairs.length]
  const cutFile = join(HOME, 'window-cut.json')
  writeFileSync(cutFile + '.tmp', JSON.stringify({ session, ts: first?.metadata?.ts || 0 }))
  renameSync(cutFile + '.tmp', cutFile)
} catch {}
console.log(`Last ${pairs.length} exchange${pairs.length === 1 ? '' : 's'} before the compaction, in full (window size ${s.pairs}, tunes itself):\n\n${pairs.join('\n\n')}`)
