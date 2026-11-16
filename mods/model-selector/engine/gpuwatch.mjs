#!/usr/bin/env node
// GPU watcher: frees the mods' small models within seconds when something else needs the GPU.
//   node gpuwatch.mjs --start   start one background watcher if none is running (called by the mod)
//   node gpuwatch.mjs --once    check once, print what it sees, free if needed, exit
//   node gpuwatch.mjs           run the watch loop in the foreground (what --start launches)
// It only ever UNLOADS (keep_alive 0) the mods' own two models on the private Ollama at 127.0.0.1:11435,
// never anything else there, and never loads anything. The mod itself loads the models when a job needs
// them and, in auto mode, goes to Haiku while the GPU is busy; this closes the gap between messages.
// It exits by itself when none of the mods' models has been loaded for a minute, or when there is no
// NVIDIA GPU to watch. One instance only (pid file).
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'http://127.0.0.1:11435'
const SMALL = 'gemma4:e4b' // keep in step with LOCAL_MODEL in hooks/register.ts
const EMBED = 'nomic-embed-text'
const MIN_MB = 4500 // keep in step with LOCAL_MIN_FREE_MB: the model plus headroom must fit beside other work
const EVERY_MS = 2000
const QUIT_AFTER_MS = 60000
const HOME = process.env.CLAUDE_HOME || join(homedir(), '.claude')
const PID = join(HOME, 'local-llm', 'gpuwatch.pid')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
// Goes through the shared recorder (rotation, 0600 mode). Never throws.
const REC = join(HOME, 'flight-recorder', 'rec.mjs')
const rec = o => { try { const { event, ...data } = o; execFileSync('node', [REC, 'model-selector', event, JSON.stringify(data)], { timeout: 3000 }) } catch {} }

function freeMb() {
  try {
    const n = Number(execFileSync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], { timeout: 2500 }).toString().trim().split('\n')[0])
    return Number.isFinite(n) ? n : undefined
  } catch { return undefined }
}
async function oursMb() {
  const r = await fetch(`${BASE}/api/ps`, { signal: AbortSignal.timeout(1500) })
  const list = (await r.json()).models ?? []
  const mine = list.filter(m => m.name === SMALL || m.name === `${SMALL}:latest` || (m.name ?? '').startsWith(EMBED))
  return Math.round(mine.reduce((n, m) => n + (m.size_vram ?? 0), 0) / 1048576)
}
async function unloadOurs() {
  for (const model of [SMALL, EMBED]) {
    await fetch(`${BASE}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }), signal: AbortSignal.timeout(4000) }).catch(() => {})
  }
}
// One look. Returns { free, ours, yielded }.
async function check() {
  const free = freeMb()
  if (free === undefined) return { free, ours: 0, yielded: false, noGpu: true }
  const ours = await oursMb()
  if (ours > 0 && free + ours < MIN_MB) {
    await unloadOurs()
    rec({ event: 'gpu_yield', freeBesidesOurs: free + ours, releasedMb: ours, by: 'watcher' })
    return { free, ours, yielded: true }
  }
  return { free, ours, yielded: false }
}

const arg = process.argv[2]
if (arg === '--once') {
  try { console.log(JSON.stringify(await check())) } catch (e) { console.log(JSON.stringify({ error: String(e.message || e) })) }
  process.exit(0)
}
if (arg === '--start') {
  let pid = 0
  try { pid = Number(readFileSync(PID, 'utf8')) } catch {}
  if (pid && alive(pid)) { console.log('running'); process.exit(0) }
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  console.log('started')
  process.exit(0)
}

// The loop.
try { mkdirSync(dirname(PID), { recursive: true }); writeFileSync(PID, String(process.pid)) } catch {}
const cleanup = () => { try { if (Number(readFileSync(PID, 'utf8')) === process.pid) rmSync(PID) } catch {} }
process.on('exit', cleanup); process.on('SIGTERM', () => process.exit(0)); process.on('SIGINT', () => process.exit(0))
let idleSince = Date.now(), failures = 0
for (;;) {
  try {
    const s = await check()
    if (s.noGpu) break // no NVIDIA GPU: nothing to watch
    failures = 0
    if (s.ours > 0 && !s.yielded) idleSince = Date.now()
  } catch { if (++failures >= 5) break } // the private Ollama is not running
  if (Date.now() - idleSince > QUIT_AFTER_MS) break
  await sleep(EVERY_MS)
}
