#!/usr/bin/env node
// Turns research material into research nodes: about one paragraph each, nothing dropped.
//   node research.mjs --topic T [--source S] [--session ID] (--file PATH | --text TEXT | stdin)
// Nodes live in the 'research' pool: never faded to cold storage, labelled RESEARCH in recall.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { openMemory, saveMemory, put, ensureHome } from './store.mjs'

const MIN = 200, MAX = 1400

// Paragraphs (blank-line separated); tiny ones merge into the next, huge ones split at sentence ends.
export function splitParagraphs(text) {
  const paras = String(text).replace(/\r/g, '').split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const out = []
  let carry = ''
  const flush = p => { if (p) out.push(p) }
  for (let p of paras) {
    if (carry) p = `${carry} ${p}`, carry = ''
    if (p.length < MIN) { carry = p; continue }
    while (p.length > MAX) {
      let cut = p.lastIndexOf('. ', MAX)
      if (cut < MAX / 2) cut = p.lastIndexOf(' ', MAX)
      if (cut < 1) cut = MAX
      flush(p.slice(0, cut + 1).trim()); p = p.slice(cut + 1).trim()
    }
    flush(p)
  }
  flush(carry)
  return out
}

export async function ingest({ text, topic = '', source = '', session = '', path = '', why = '', project = '' }) {
  const parts = splitParagraphs(text)
  if (!parts.length) return { added: 0, total: 0 }
  const mem = openMemory()
  const now = Date.now()
  let added = 0
  for (let i = 0; i < parts.length; i++) {
    const id = `r:${createHash('sha1').update(parts[i]).digest('hex').slice(0, 16)}`
    const node = await put(mem, 'research', { id, content: parts[i], metadata: { ts: now, kind: 'research', topic, source, session, path: path || `research/${topic}`, why, rproject: project, n: i + 1, of: parts.length, project: 'research', strength: 1, lastTouched: now } })
    if (node) added++
  }
  if (added) saveMemory(mem)
  return { added, total: parts.length }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2)
  const arg = k => { const i = a.indexOf(k); return i === -1 ? undefined : a[i + 1] }
  ensureHome()
  const text = arg('--text') ?? (arg('--file') ? readFileSync(arg('--file'), 'utf8') : readFileSync(0, 'utf8'))
  const r = await ingest({ text, topic: arg('--topic') || '', source: arg('--source') || '', session: arg('--session') || '', path: arg('--path') || '', why: arg('--why') || '', project: arg('--project') || '' })
  console.log(`Research nodes: ${r.added} new of ${r.total} paragraphs (duplicates skipped).`)
}
