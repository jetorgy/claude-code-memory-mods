#!/usr/bin/env node
// Records an explicit mark from Claude (the mark tool). The indexer applies it to the right
// exchange once this turn is saved into memory.
//   node mark.mjs --session ID --kind wrong_answer|frustrated|worked|lesson|important [--note TEXT] [--target previous|current]
import { appendFileSync } from 'node:fs'
import { ensureHome, MARKS_PATH } from './store.mjs'

export const KINDS = ['wrong_answer', 'frustrated', 'worked', 'lesson', 'important']

const a = process.argv.slice(2)
const arg = k => { const i = a.indexOf(k); return i === -1 ? undefined : a[i + 1] }
const kind = arg('--kind'), session = arg('--session'), note = (arg('--note') || '').trim().slice(0, 1000)
const target = arg('--target') === 'current' ? 'current' : 'previous'
// An error fingerprint (from errors.mjs) ties a lesson to that error, so it comes back when it recurs.
const sig = arg('--sig') || undefined
if (!KINDS.includes(kind) || !session) { console.error(`kind must be one of ${KINDS.join(', ')} and a session is needed`); process.exit(2) }
if (kind === 'lesson' && !note) { console.error('a lesson needs a note: the rule to remember'); process.exit(2) }
ensureHome()
appendFileSync(MARKS_PATH, `${JSON.stringify({ session, ts: Date.now(), kind, note, target, ...(sig ? { sig } : {}) })}\n`, { mode: 0o600 })
const what = {
  wrong_answer: 'the previous answer is marked wrong; whatever memory fed it gets weaker',
  frustrated: 'the previous answer is marked wrong and the user frustrated; the lesson is kept longer',
  worked: 'the previous answer is marked as confirmed working; whatever memory fed it gets stronger',
  lesson: 'the lesson is saved and will come back in related work and in new-session handoffs',
  important: `the ${target} exchange is marked important; it fades much more slowly`,
}[kind]
console.log(`Marked (${kind}): ${what}. Applied when this turn is saved into memory.`)
