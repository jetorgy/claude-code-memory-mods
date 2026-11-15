#!/usr/bin/env node
// Correct a memory the moment it is seen to be wrong or outdated, so it is fixed when it happens and
// not after. Writes to corrections.json, which every lookup reads, so the very next recall shows the
// corrected version (or nothing, if forgotten). The original node is never deleted: a correction is
// an overlay, and `--undo` removes it.
//   node correct.mjs (--ref TAG | --tool NAME --error TEXT) (--fix TEXT | --forget | --undo) [--session ID] [--why TEXT]
// --ref: the tag shown beside a remembered item (ref xxxxxxxx).
// --tool + --error: the failing call, for the "this exact error happened N times" note (no tag shown there).
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { openMemory, openCold, existsMemory, loadState, loadCorrections, saveCorrections, refOf, TOOLINDEX_PATH, COLD_PATH } from './store.mjs'
import { signatureOf, scrub } from './parse.mjs'

const a = process.argv.slice(2)
const arg = k => { const i = a.indexOf(k); return i === -1 ? undefined : a[i + 1] }
const ref = arg('--ref'), tool = arg('--tool'), error = arg('--error')
const fix = (arg('--fix') || '').trim().slice(0, 700)
const forget = a.includes('--forget'), undo = a.includes('--undo')
const fail = m => { console.error(m); process.exit(2) }

if (!ref && !(tool && error)) fail('say what to correct: --ref TAG (shown beside the item) or --tool and --error (the failing call)')
if (!fix && !forget && !undo) fail('say how: a corrected fix/lesson text, forget it, or undo an earlier correction')
if (fix && forget) fail('give either a corrected text or forget, not both')
if (!existsMemory()) fail('memory is empty, nothing to correct')

const mem = openMemory()
const cold = existsSync(COLD_PATH) ? openCold() : null
const find = id => mem.get(id) ?? cold?.get(id) ?? null

let node = null
if (ref) {
  if (!/^[0-9a-f]{8}$/.test(ref)) fail('a tag is 8 letters/digits, as shown beside the item: "ref xxxxxxxx"')
  for (const store of [mem, cold]) {
    if (!store || node) continue
    for (const pool of ['lesson', 'failure', 'correction', 'request', 'response', 'image', 'thinking']) {
      node = store.pool(pool).list().find(n => refOf(n.id) === ref) ?? null
      if (node) break
    }
  }
  if (!node) fail(`no memory has the tag ${ref}; it may be from an older session than is shown, or already gone`)
} else {
  const sig = signatureOf(tool, scrub(error))
  const id = loadState().sigs?.[sig]
  node = id ? find(id) : null
  if (!node) fail('no remembered failure matches that tool and error text; pass the error exactly as it was shown')
}

const corr = loadCorrections()
const was = corr[node.id]
if (undo) {
  if (!was) fail('that memory has no correction to undo')
  delete corr[node.id]
} else {
  corr[node.id] = { ...(forget ? { forget: true } : { fix }), ts: Date.now(), session: arg('--session') || '', ...(arg('--why') ? { why: arg('--why').slice(0, 300) } : {}) }
}
saveCorrections(corr)

// The small per-tool index feeds the check before each tool call; patch it now so that check is
// corrected at once too (it is rebuilt from corrections on the next indexer run as well).
let patched = 0
if (node.pool === 'lesson' && existsSync(TOOLINDEX_PATH)) {
  try {
    const idx = JSON.parse(readFileSync(TOOLINDEX_PATH, 'utf8'))
    const key = (node.content ?? '').replace(/\s+/g, ' ').slice(0, 300)
    const hit = idx.lessons.find(l => l.id === node.id || l.text === key)
    if (hit) {
      if (forget) idx.lessons = idx.lessons.filter(l => l !== hit)
      else if (fix) {
        hit.text = fix.replace(/\s+/g, ' ').slice(0, 300)
        hit.tools = [...new Set([...hit.tools, ...(fix.match(/mcp__[\w-]+__[\w-]+|\b(?:Bash|Edit|Write|Read|Grep|Glob|WebFetch|WebSearch)\b/g) ?? [])])]
      }
      patched = 1
      const tmp = `${TOOLINDEX_PATH}.tmp`
      writeFileSync(tmp, JSON.stringify(idx), { mode: 0o600 })
      renameSync(tmp, TOOLINDEX_PATH)
    }
  } catch {}
}

const what = (node.content ?? '').replace(/\s+/g, ' ').slice(0, 90)
console.log(`${undo ? 'Correction undone' : forget ? 'Forgotten' : 'Corrected'} (${node.pool}, ${node.metadata.project ?? '?'}): "${what}". ` +
  `${undo ? 'The original shows again.' : forget ? 'It will not be shown again.' : 'The next lookup shows your corrected text instead.'}${patched ? ' The tool-call check is updated too.' : ''}`)
