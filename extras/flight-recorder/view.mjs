#!/usr/bin/env node
// Read the flight recorder.  node view.mjs [--last N] [--since 30m|2h|1d] [--source NAME]
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const a = process.argv.slice(2)
const arg = k => { const i = a.indexOf(k); return i === -1 ? undefined : a[i + 1] }
const dir = dirname(fileURLToPath(import.meta.url))
let rows = []
try { rows = readFileSync(join(dir, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch {}
const since = arg('--since')
if (since) {
  const m = since.match(/^(\d+)([mhd])$/)
  if (m) { const ms = Number(m[1]) * { m: 6e4, h: 36e5, d: 864e5 }[m[2]]; rows = rows.filter(r => Date.now() - Date.parse(r.ts) <= ms) }
}
const src = arg('--source'); if (src) rows = rows.filter(r => r.source === src)
if (!rows.length) { console.log('flight recorder: no events yet'); process.exit(0) }
const count = {}; let chars = 0, items = 0
for (const r of rows) {
  const k = `${r.source}/${r.event}`; count[k] = (count[k] || 0) + 1
  chars += Number(r.chars || 0); items += Number(r.items || 0)
}
console.log(`flight recorder: ${rows.length} events, ${rows[0].ts.slice(0, 16)} -> ${rows.at(-1).ts.slice(0, 16)}`)
for (const [k, n] of Object.entries(count).sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(4)}  ${k}`)
const turns = rows.filter(r => r.event === 'turn_done' && r.usage)
if (turns.length) {
  const tot = {}
  for (const t of turns) for (const [k, v] of Object.entries(t.usage)) if (typeof v === 'number') tot[k] = (tot[k] || 0) + v
  console.log(`real usage over ${turns.length} turns: ${Object.entries(tot).map(([k, v]) => `${k}=${v}`).join(' ')}`)
}
console.log(`injected by memory/selector: ~${Math.round(chars / 4)} tokens (${chars} chars), ${items} recalled items`)
const lastRaw = Number(arg('--last') ?? 8)
const last = Number.isFinite(lastRaw) && lastRaw > 0 ? Math.floor(lastRaw) : 8
console.log(`last ${Math.min(last, rows.length)}:`)
for (const r of rows.slice(-last)) {
  const { ts, source, event, ...rest } = r
  console.log(`  ${ts.slice(11, 19)} ${source}/${event} ${JSON.stringify(rest).slice(0, 160)}`)
}
