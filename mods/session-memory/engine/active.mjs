#!/usr/bin/env node
// The active nodes list: what is in the working memory right now (as opposed to cold storage), how
// much of each kind, and the strongest memories first. Kept short on purpose.
//   node active.mjs [--pool lesson|failure|correction|request|response|image] [--limit N]
import { openMemory, loadState, existsMemory, CONTENT_POOLS } from './store.mjs'
import { strengthOf } from './strength.mjs'

const a = process.argv.slice(2)
const arg = k => { const i = a.indexOf(k); return i === -1 ? undefined : a[i + 1] }
if (!existsMemory()) { console.log('The memory is empty so far.'); process.exit(0) }
const mem = openMemory()
const cold = loadState().cold ?? {}
const coldBy = {}
for (const p of Object.values(cold)) coldBy[p] = (coldBy[p] ?? 0) + 1
const day = ts => new Date(ts).toISOString().slice(0, 10)
const clip = (s, n) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }

const kinds = CONTENT_POOLS.map(p => [p, mem.pool(p).size, coldBy[p] ?? 0]).filter(([, n, c]) => n + c > 0)
const total = kinds.reduce((n, [, x]) => n + x, 0)
const totalCold = Object.keys(cold).length
const out = [`Active memory: ${total} nodes in use, ${totalCold} in cold storage (searched only when active memory has nothing).`,
  `By kind (active / cold): ${kinds.map(([p, n, c]) => `${p} ${n}/${c}`).join(' · ')}`]

// thinking, tool calls and plain successes are bulk; the list shows the memories that carry meaning.
const pool = arg('--pool')
const pools = pool ? [pool] : ['lesson', 'failure', 'correction', 'request', 'response', 'image']
const limit = Math.max(1, Math.min(30, Number(arg('--limit')) || 12))
const now = Date.now()
const top = pools.flatMap(p => mem.pool(p).list()).map(n => ({ n, s: strengthOf(n.metadata, now) }))
  .sort((x, y) => y.s - x.s || y.n.metadata.ts - x.n.metadata.ts).slice(0, limit)
out.push(`Strongest active${pool ? ` ${pool}` : ''} memories (top ${top.length}):`)
for (const { n, s } of top) {
  const m = n.metadata
  const extra = [m.count > 1 ? `seen ${m.count}×` : '', m.reuses ? `reused ${m.reuses}×` : '', m.outcome === 'corrected' ? 'corrected' : '', m.important ? 'important' : ''].filter(Boolean).join(', ')
  out.push(`- ${n.pool} · ${m.project ?? '?'} · ${day(m.ts)} · strength ${s.toFixed(2)}${extra ? ` · ${extra}` : ''}: ${clip(n.content, 90)}`)
}
out.push('Narrow it with /recall active <kind> (lesson, failure, correction, request, response, image).')
console.log(out.join('\n'))
