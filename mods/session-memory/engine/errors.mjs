#!/usr/bin/env node
// The error watcher's lookup: has this exact error (by fingerprint) happened before, how often,
// and is there a known fix or a researched lesson for it?
//   node errors.mjs --tool NAME --body "error text"   -> one line of JSON
import { existsSync } from 'node:fs'
import { openMemory, openCold, existsMemory, loadState, lookup, loadCorrections, COLD_PATH } from './store.mjs'
import { signatureOf, scrub, HARNESS_ERROR } from './parse.mjs'

const a = process.argv.slice(2)
const arg = k => { const i = a.indexOf(k); return i === -1 ? undefined : a[i + 1] }
const tool = arg('--tool') || 'tool'
const sig = signatureOf(tool, scrub(arg('--body') || ''))
const out = { sig, known: false }
// A permission outage or a declined prompt is not an error worth remembering or researching.
if (existsMemory() && !HARNESS_ERROR.test(arg('--body') || '')) {
  const state = loadState()
  const id = state.sigs?.[sig]
  if (id) {
    const mem = openMemory()
    const get = lookup(mem, !mem.has(id) && existsSync(COLD_PATH) ? openCold() : null)
    const f = get(id)
    // Corrections Claude made on the spot: a forgotten error is treated as unknown; a corrected fix replaces the old one.
    const corr = loadCorrections()
    if (f && !corr[id]?.forget) {
      const own = corr[id]?.fix ?? null
      const fix = own || corr[f.metadata.fixedBy]?.forget ? null : get(f.metadata.fixedBy)
      const fixCall = fix ? get(fix.metadata.parent) : null
      const lesson = own || corr[f.metadata.lesson]?.forget ? null : get(f.metadata.lesson)
      Object.assign(out, {
        known: true, id, count: f.metadata.count ?? 1, project: f.metadata.project,
        fixes: f.metadata.fixes ?? 0,
        fix: fix ? `${(fixCall?.content ?? '').slice(0, 200)} → ${(fix.content ?? '').replace(/^[^:]*: /, '').slice(0, 200)}` : null,
        lesson: own ?? (corr[lesson?.id]?.fix ?? lesson?.content ?? null),
        corrected: Boolean(own),
      })
    }
  }
}
console.log(JSON.stringify(out))
