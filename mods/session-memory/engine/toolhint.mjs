#!/usr/bin/env node
// The pre-call check: what happened the last times this exact tool call (or tool + file) was made?
//   node toolhint.mjs --tool NAME --input '{"command":"..."}' [--project NAME]
// Prints one line of JSON: { deny?, note? }. Reads only the small tool index, so it is fast.
//  - deny: this exact call failed 2+ times in earlier sessions and never once worked. The mod holds
//          it once per session so the known cause is seen before it is repeated.
//  - note: shown to Claude right after the call (still before its next step): the same tool+file
//          failed repeatedly before, or a saved lesson names this tool.
import { readFileSync, existsSync } from 'node:fs'
import { TOOLINDEX_PATH } from './store.mjs'
import { summarizeInput, targetOf } from './parse.mjs'

const a = process.argv.slice(2)
const arg = k => { const i = a.indexOf(k); return i === -1 ? undefined : a[i + 1] }
const tool = arg('--tool') || ''
const project = (arg('--project') || '').toLowerCase()
let input = {}
try { input = JSON.parse(arg('--input') || '{}') } catch {}
const out = {}
if (tool && existsSync(TOOLINDEX_PATH)) {
  const idx = JSON.parse(readFileSync(TOOLINDEX_PATH, 'utf8'))
  const key = `${tool}: ${summarizeInput(input)}`
  const ex = idx.exact[key]
  const target = targetOf(input)
  const lo = target && tool !== 'Bash' ? idx.loose[`${tool}|${target}`] : null
  const lesson = idx.lessons
    .filter(l => l.tools.includes(tool))
    .sort((x, y) => (y.project?.toLowerCase() === project) - (x.project?.toLowerCase() === project))[0]
  const day = ts => new Date(ts).toISOString().slice(0, 10)
  if (ex && ex.fail >= 2 && ex.ok === 0) {
    out.deny = `SESSION-MEMORY HOLD: this exact ${tool} call failed ${ex.fail} times in earlier sessions and never worked (last ${day(ex.errTs)}: ${ex.err}).` +
      `${lesson ? ` Saved lesson: ${lesson.text.slice(0, 220)}` : ''} Change something first, or use investigate_error. The same call will go through if you repeat it.`
  }
  const notes = []
  if (lo && lo.fail >= 2 && lo.ok === 0 && !out.deny) notes.push(`${tool} on this target failed ${lo.fail} times before and never worked (last: ${lo.err}).`)
  if (lesson) notes.push(`Saved lesson for ${tool}: ${lesson.text.slice(0, 240)}`)
  if (notes.length) out.note = notes.join(' ')
  // Has this tool ever failed? Decides whether a similarity search after a successful call is worth it.
  if ((idx.tools?.[tool]?.fail ?? 0) > 0) out.seenFail = true
}
console.log(JSON.stringify(out))
