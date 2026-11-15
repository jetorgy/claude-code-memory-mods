// The memory's storage, built on the @automacene/liminal-memory library (pools of nodes,
// BM25 recall, graph links). This file only opens it, saves it, and holds the settings.
import { LiminalMemory } from '@automacene/liminal-memory'
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const HOME = process.env.SESSION_MEMORY_HOME || join(homedir(), '.claude', 'session-memory')
export const IMAGES = join(HOME, 'images')
export const MEM_PATH = join(HOME, 'memory.json')
// Cold storage: faded memories, compressed losslessly. Still searchable; a used one warms back up.
export const COLD_PATH = join(HOME, 'cold.json.gz')
export const STATE_PATH = join(HOME, 'state.json')
export const CONFIG_PATH = join(HOME, 'config.json')
// Every recall the mod attached to a prompt (session, time, question, node ids): the learning record.
export const RECALLS_PATH = join(HOME, 'recalls.jsonl')
export const LAST_INDEX_PATH = join(HOME, 'last-index.json')
export const LOCK_PATH = join(HOME, 'index.lock')
// Small per-tool history (what each exact tool call did before), so a call can be checked in a few
// milliseconds without opening the whole memory.
export const TOOLINDEX_PATH = join(HOME, 'toolindex.json')
// Explicit marks Claude makes with the mark tool (wrong answer, frustrated, worked, lesson, important).
export const MARKS_PATH = join(HOME, 'marks.jsonl')

// Corrections Claude makes on the spot (correct_memory tool): { [nodeId]: { forget?, fix?, ts, session } }.
// Read by every lookup, so a correction applies on the very next one, with no re-index.
export const CORRECTIONS_PATH = join(HOME, 'corrections.json')
export const loadCorrections = () => { try { return JSON.parse(readFileSync(CORRECTIONS_PATH, 'utf8')) } catch { return {} } }
export const saveCorrections = c => writeAtomic(CORRECTIONS_PATH, JSON.stringify(c))
// A short stable tag for a node, shown beside each remembered item so it can be named in a correction.
export const refOf = id => createHash('sha1').update(String(id)).digest('hex').slice(0, 8)

// One pool per kind of node, so each pool's scoring statistics stay clean.
// group / project / session / helper are structural (no searchable content): they only hold the hierarchy.
export const POOLS = ['group', 'project', 'session', 'helper', 'lesson', 'request', 'correction', 'response', 'thinking', 'tool_call', 'failure', 'success', 'image']

export const DEFAULT_CONFIG = {
  // Project folders whose name contains any of these are never read. Case-insensitive.
  excludeProjects: ['personal', 'session-memory'],
  // Which pools may be shown back to the model.
  recallPools: ['lesson', 'request', 'correction', 'response', 'failure', 'thinking', 'image'],
  // Everything shown stays in the conversation and is re-sent every turn, so it is kept small.
  // The most related few, never a long list: a focused handful is what the model can act on.
  maxResults: 5,
  maxChars: 2400,
  // Liminal scores run 0..1: a real match is near 0.9, incidental word overlap near 0.25.
  minScore: 0.7,
  // Local semantic recall next to the keyword recall (embed.mjs). Needs the private Ollama on
  // 127.0.0.1:11435 and the model downloaded; with neither, recall is keyword-only. false = off.
  embeddings: true,
  embedModel: 'nomic-embed-text',
  embedPrefix: true,
  // 'all' = every project (current one first); 'project' = only the current project.
  scope: 'all',
  // Optional: path fragment -> group name, e.g. {"solidcraft": "CAD"}. Otherwise the group is the
  // drive or top folder the project lives in (Asteres_Archivum, Desktop, home).
  groups: {},
  // Cold storage: a memory older than this whose strength has faded below coldBelow moves out of
  // active memory. Nothing is deleted; using it again brings it back.
  coldAfterDays: 14,
  coldBelow: 0.1,
  // New-session handoff: how many of the most recent messages (from earlier sessions) to carry over.
  handoffMessages: 10,
  // The last-messages buffer is the point of the handoff, so it is sized for 10 short exchanges.
  handoffMaxChars: 4200,
}

// Pools whose nodes can fade to cold storage (structure never does).
export const CONTENT_POOLS = ['lesson', 'request', 'correction', 'response', 'thinking', 'tool_call', 'failure', 'success', 'image']

export function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) } } catch { return { ...DEFAULT_CONFIG } }
}

export function ensureHome() {
  mkdirSync(HOME, { recursive: true, mode: 0o700 })
  mkdirSync(IMAGES, { recursive: true, mode: 0o700 })
  try { chmodSync(HOME, 0o700) } catch {}
}

// onEvict is Liminal's own hook: evicted nodes are handed to it before they leave the pool.
export function openMemory({ onEvict } = {}) {
  ensureHome()
  const mem = new LiminalMemory({ defaultPool: 'request', ...(onEvict ? { onEvict } : {}) })
  for (const p of POOLS) mem.pool(p)
  if (existsSync(MEM_PATH)) mem.load(JSON.parse(readFileSync(MEM_PATH, 'utf8')))
  return mem
}

export function openCold() {
  const cold = new LiminalMemory({ defaultPool: 'request' })
  for (const p of POOLS) cold.pool(p)
  if (existsSync(COLD_PATH)) cold.load(JSON.parse(gunzipSync(readFileSync(COLD_PATH)).toString('utf8')))
  return cold
}

function writeAtomic(path, text) {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text, { mode: 0o600 })
  renameSync(tmp, path)
}

export const saveMemory = mem => writeAtomic(MEM_PATH, JSON.stringify(mem))
export const saveToolIndex = idx => writeAtomic(TOOLINDEX_PATH, JSON.stringify(idx))
export const saveCold = cold => writeAtomic(COLD_PATH, gzipSync(JSON.stringify(cold)))
export const loadState = () => { try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')) } catch { return { files: {}, sessions: {} } } }
export const saveState = s => writeAtomic(STATE_PATH, JSON.stringify(s))
export const existsMemory = () => existsSync(MEM_PATH)

// The strength a brand-new memory starts with, so recent work stays active for a while even if
// it is never reused; after that it fades unless it earns its place (strength.mjs).
export const CREATION_STRENGTH = 0.3

// Creates a node once; a second call with the same id does nothing.
export async function put(mem, pool, { id, content = null, metadata = {} }) {
  if (mem.has(id)) return null
  if (content !== null && metadata.lastTouched === undefined) {
    metadata = { ...metadata, strength: CREATION_STRENGTH, lastTouched: metadata.ts || Date.now() }
  }
  return mem.pool(pool).create({ id, content, metadata })
}

// Finds a node in active memory, then in cold storage.
export const lookup = (mem, cold) => id => (id ? mem.get(id) ?? cold?.get(id) ?? null : null)
