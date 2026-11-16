#!/usr/bin/env node
// Optional semantic layer: local embeddings that sit NEXT TO the keyword (BM25) ranking, never
// instead of it. A question and a memory that mean the same thing in different words can then
// find each other. Everything is local: the vectors come from an embedding model (default
// nomic-embed-text) in the private Ollama on 127.0.0.1:11435 and are kept in two files beside the
// memory. If that Ollama is off, or the model is not downloaded, every function here quietly
// returns null/0 and recall is exactly the keyword recall it always was.
//   node embed.mjs            embed whatever is missing (what the indexer also does), print counts
//   node embed.mjs --status   print how many memories have vectors
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { HOME, openMemory, openCold, loadConfig } from './store.mjs'

// The kinds of memory that can be recalled by meaning. Thinking, tool calls and successes are far
// more numerous and are found by keyword only.
export const EMBED_POOLS = ['lesson', 'correction', 'request', 'response', 'failure', 'research']
const IDX_PATH = join(HOME, 'embeddings.json')
const BIN_PATH = join(HOME, 'embeddings.bin')
const BASE = process.env.SESSION_MEMORY_EMBED_URL || 'http://127.0.0.1:11435'
const BATCH = 32
const DOC_CHARS = 1000

const enabled = cfg => cfg.embeddings !== false
const prefix = (cfg, kind) => (cfg.embedPrefix !== false && /nomic/i.test(cfg.embedModel) ? (kind === 'query' ? 'search_query: ' : 'search_document: ') : '')

function unit(v) {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  n = Math.sqrt(n) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n
  return out
}

// One call to the local model for a list of texts. null on any problem (server off, model missing, timeout).
export async function embedBatch(texts, kind, { cfg = loadConfig(), timeoutMs = 20000 } = {}) {
  if (!enabled(cfg) || !texts.length) return null
  try {
    const res = await fetch(`${BASE}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.embedModel, input: texts.map(t => prefix(cfg, kind) + t), truncate: true, keep_alive: '5m' }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const { embeddings } = await res.json()
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) return null
    return embeddings.map(e => unit(Float32Array.from(e)))
  } catch { return null }
}

export const embedQuery = async (q, opts = {}) => (await embedBatch([q.slice(0, DOC_CHARS)], 'query', opts))?.[0] ?? null

// ---- the vector file: embeddings.json = { model, dim, ids }, embeddings.bin = ids.length * dim float32 ----
let CACHE
export function loadVectors() {
  if (CACHE !== undefined) return CACHE
  CACHE = null
  try {
    if (!existsSync(IDX_PATH) || !existsSync(BIN_PATH)) return CACHE
    const { model, dim, ids } = JSON.parse(readFileSync(IDX_PATH, 'utf8'))
    const buf = readFileSync(BIN_PATH)
    if (buf.length !== ids.length * dim * 4) return CACHE // half-written: ignore, the next index repairs it
    // Copy into an aligned buffer: a Buffer from readFileSync can start at an odd offset.
    const data = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length))
    CACHE = { model, dim, ids, data, row: new Map(ids.map((id, i) => [id, i])) }
  } catch { CACHE = null }
  return CACHE
}

function writeAtomic(path, data) {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data, { mode: 0o600 })
  renameSync(tmp, path)
}

function saveVectors(model, dim, ids, data) {
  writeAtomic(BIN_PATH, Buffer.from(data.buffer, data.byteOffset, data.byteLength))
  writeAtomic(IDX_PATH, JSON.stringify({ model, dim, ids }))
  CACHE = undefined
}

// Cosine similarity (vectors are unit length) of the query against every stored vector, top `k`.
// Returns [{ id, cos }] best first; [] when there are no vectors or they came from another model.
export function nearest(qv, cfg = loadConfig(), k = 40) {
  const v = loadVectors()
  if (!qv || !v || v.model !== cfg.embedModel || v.dim !== qv.length) return []
  const out = []
  for (let r = 0; r < v.ids.length; r++) {
    let dot = 0
    const o = r * v.dim
    for (let i = 0; i < v.dim; i++) dot += v.data[o + i] * qv[i]
    out.push({ id: v.ids[r], cos: dot })
  }
  return out.sort((a, b) => b.cos - a.cos).slice(0, k)
}

// Cosine similarity of the query with one stored memory; null when that memory has no vector.
export function cosOf(qv, id, cfg = loadConfig()) {
  const v = loadVectors()
  const r = v && v.model === cfg.embedModel && qv && v.dim === qv.length ? v.row.get(id) : undefined
  if (r === undefined) return null
  let dot = 0
  const o = r * v.dim
  for (let i = 0; i < v.dim; i++) dot += v.data[o + i] * qv[i]
  return dot
}

const textOf = n => (n?.content ?? '').toString().replace(/\s+/g, ' ').trim().slice(0, DOC_CHARS)

// Embeds every recallable memory (active and cold) that has no vector yet, within a time budget,
// and drops vectors for memories that no longer exist. Safe to run any time and to interrupt.
export async function embedMissing({ mems, budgetMs = 60000, log = () => {} } = {}) {
  const cfg = loadConfig()
  if (!enabled(cfg)) return { skipped: 'embeddings are switched off in config.json' }
  const opened = mems ?? [openMemory(), existsSync(join(HOME, 'cold.json.gz')) ? openCold() : null].filter(Boolean)
  const nodes = new Map()
  for (const m of opened) for (const p of EMBED_POOLS) for (const n of m.pool(p).list()) if (textOf(n)) nodes.set(n.id, n)
  const old = loadVectors()
  const same = old && old.model === cfg.embedModel
  const keepIds = same ? old.ids.filter(id => nodes.has(id)) : []
  const have = new Set(keepIds)
  const todo = [...nodes.values()].filter(n => !have.has(n.id))
  let dim = same ? old.dim : 0
  const rows = keepIds.map(id => old.data.subarray(old.row.get(id) * old.dim, (old.row.get(id) + 1) * old.dim))
  const ids = [...keepIds]
  const t0 = Date.now()
  let added = 0, saved = 0
  // Progress is saved as it goes (every 5 batches), so a run cut off by a hook timeout loses little.
  const flush = () => {
    const data = new Float32Array(ids.length * dim)
    rows.forEach((r, i) => data.set(r, i * dim))
    saveVectors(cfg.embedModel, dim, ids, data)
    saved = added
  }
  for (let i = 0, b = 0; i < todo.length && Date.now() - t0 < budgetMs; i += BATCH, b++) {
    const chunk = todo.slice(i, i + BATCH)
    const vecs = await embedBatch(chunk.map(textOf), 'doc', { cfg })
    if (!vecs) { log('embedding server not available; stopping'); break }
    dim = dim || vecs[0].length
    if (vecs[0].length !== dim) { log('embedding size changed; stopping'); break }
    chunk.forEach((n, j) => { ids.push(n.id); rows.push(vecs[j]); added++ })
    if (b % 5 === 4) flush()
  }
  const pruned = same ? old.ids.length - keepIds.length : 0
  if (dim && (added > saved || pruned || (old && !same))) flush()
  return { added, pruned, total: ids.length, remaining: nodes.size - ids.length, model: cfg.embedModel }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--status')) {
    const v = loadVectors()
    console.log(JSON.stringify(v ? { model: v.model, dim: v.dim, vectors: v.ids.length } : { vectors: 0 }))
  } else {
    const t0 = Date.now()
    console.log(JSON.stringify({ ...(await embedMissing({ log: m => console.error(m) })), seconds: (Date.now() - t0) / 1000 }))
  }
}
