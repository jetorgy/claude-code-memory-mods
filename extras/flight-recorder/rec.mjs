#!/usr/bin/env node
// Flight recorder: append one JSON line per mod decision.  node rec.mjs SOURCE EVENT [JSON]
// Never throws: a recorder must not break a mod. Rotates log.jsonl at 5 MB (keeps one old copy).
import { appendFileSync, statSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
try {
  const dir = dirname(fileURLToPath(import.meta.url))
  const [source = '?', event = '?', json = '{}'] = process.argv.slice(2)
  let data = {}
  try { data = JSON.parse(json) } catch { data = { raw: String(json).slice(0, 300) } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = { value: data }
  const file = join(dir, 'log.jsonl')
  mkdirSync(dir, { recursive: true })
  try { if (statSync(file).size > 5_000_000) renameSync(file, join(dir, 'log.old.jsonl')) } catch {}
  appendFileSync(file, `${JSON.stringify({ ...data, ts: new Date().toISOString(), source, event })}\n`, { mode: 0o600 })
} catch {}
