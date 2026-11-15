#!/usr/bin/env node
// The most related past things to what Claude is doing right now with a tool: similar failures and
// their fixes, corrections, saved lessons. Ranked by similarity (Liminal), not by exact match, and
// kept to a focused handful: at most 5, and only strong matches, so it can return fewer or nothing.
//   node callmem.mjs --tool NAME --input JSON [--error TEXT] [--project NAME] [--session ID] [--strict]
// Prints one line of JSON: { note, ids } or {}.
import { openMemory, loadConfig, existsMemory, RECALLS_PATH } from './store.mjs'
import { appendFileSync } from 'node:fs'
import { extractKeywords, stem } from '@automacene/liminal-memory'
import { recall, render, shownIn } from './recall.mjs'
import { summarizeInput, HARNESS_ERROR } from './parse.mjs'

const a = process.argv.slice(2)
const arg = k => { const i = a.indexOf(k); return i === -1 ? undefined : a[i + 1] }
const tool = arg('--tool') || ''
const error = (arg('--error') || '').trim()
let input = {}
try { input = JSON.parse(arg('--input') || '{}') } catch {}
const strict = a.includes('--strict') // after a call that worked: only very strong matches
if (!tool || !existsMemory() || (error && HARNESS_ERROR.test(error))) { console.log('{}'); process.exit(0) }

// The question is what the call does and how it failed. The tool's own name is only added when
// that is too thin to match on (a generic `ls` matches everything that ever ran `ls`), and a
// question with fewer than 3 meaningful words gets nothing: no guess is better than a loose one.
const body = [summarizeInput(input), error.replace(/<\/?tool_use_error>/g, '').slice(0, 300)].join(' ')
const meaningful = t => new Set(extractKeywords(t).map(stem)).size
const q = meaningful(body) >= 2 ? body : `${tool.replace(/^mcp__/, '').replace(/__/g, ' ')} ${body}`
if (meaningful(q) < 3) { console.log('{}'); process.exit(0) }
// --topic is stricter still: paths and bare listings (`ls`, `cd`, `cat X`) say where Claude is, not
// what it is doing, and match everything. Without paths it needs 4+ meaningful words of its own.
const topic = a.includes('--topic')
if (topic) {
  const noPaths = body.replace(/(?:~|\.{0,2})?\/[\w.@%+-]*(?:\/[\w.@%+-]*)*/g, ' ').replace(/\b(ls|cd|cat|head|tail|pwd|echo|sleep)\b/g, ' ')
  if (meaningful(noPaths) < 4) { console.log('{}'); process.exit(0) }
}
const cfg = {
  ...loadConfig(),
  // --topic: a mid-run topic-change lookup. Wider pools (what was asked and answered before).
  recallPools: a.includes('--topic') ? ['lesson', 'correction', 'request', 'response'] : ['failure', 'lesson', 'correction'],
  minScore: topic ? 0.88 : strict ? 0.8 : 0.7,
  minShare: topic ? 0.7 : strict ? 0.6 : 0.5,
  maxResults: 5,
  scope: 'all',
  semantic: false, // tool-call recall stays exact keyword matching: fast, and an error string is not a meaning
}
const mem = openMemory()
const session = arg('--session') || ''
const limit = Math.max(1, Math.min(5, Number(arg('--limit')) || 5))
const { items } = await recall({ mem, q, cwd: `/${arg('--project') || ''}`, session, limit, cfg, skip: shownIn(session) })
const note = render({ items, plain: true }, 1500)
// Recorded so the same items are never shown again this session; kind "tool" keeps them out of the
// message-learning match (which only credits memory shown with a user's message).
if (note && session) appendFileSync(RECALLS_PATH, `${JSON.stringify({ session, ts: Date.now(), kind: 'tool', q: q.slice(0, 120), ids: items.flatMap(i => i.ids) })}\n`, { mode: 0o600 })
console.log(JSON.stringify(note ? { note: note.replace(/^Memory results[^\n]*\n\n?/, '').trim(), ids: items.flatMap(i => i.ids) } : {}))
