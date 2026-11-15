#!/usr/bin/env node
// Reads saved Claude sessions into the Liminal memory, only what is new since last time.
// Includes each session's helper (sub-agent) transcripts from <session>/subagents/.
//   node index.mjs        read everything new, save, print counts
import { readdirSync, statSync, openSync, readSync, closeSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { openMemory, openCold, saveMemory, saveCold, saveToolIndex, loadState, saveState, loadConfig, loadCorrections, ensureHome, POOLS, CONTENT_POOLS, RECALLS_PATH, LAST_INDEX_PATH, LOCK_PATH } from './store.mjs'
import { strengthOf } from './strength.mjs'
import { processLine, helperIdOf, HARNESS_ERROR } from './parse.mjs'
import { applyMarks } from './marks-apply.mjs'

const ROOT = process.env.CLAUDE_PROJECTS_DIR || join(homedir(), '.claude', 'projects')
const CHUNK = 8 * 1024 * 1024

// Every transcript to read: [file, session id, helper id or null].
function transcripts(cfg) {
  const out = []
  const excluded = cfg.excludeProjects.map(s => s.toLowerCase())
  for (const dir of readdirSync(ROOT)) {
    if (excluded.some(x => dir.toLowerCase().includes(x))) continue
    const full = join(ROOT, dir)
    let entries
    try { entries = readdirSync(full, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) out.push({ path: join(full, e.name), dir, session: basename(e.name, '.jsonl'), helper: null })
      if (e.isDirectory()) {
        const sub = join(full, e.name, 'subagents')
        if (!existsSync(sub)) continue
        for (const f of readdirSync(sub)) if (f.endsWith('.jsonl')) out.push({ path: join(sub, f), dir, session: e.name, helper: helperIdOf(f) })
      }
    }
  }
  // Main transcripts first, so a helper's session node already exists when its lines arrive.
  return out.sort((a, b) => (a.helper ? 1 : 0) - (b.helper ? 1 : 0) || a.path.localeCompare(b.path))
}

// The recall record the mod writes: which memory was attached to which prompt.
function loadRecalls() {
  const bySession = new Map()
  if (!existsSync(RECALLS_PATH)) return bySession
  for (const line of readFileSync(RECALLS_PATH, 'utf8').split('\n')) {
    if (!line) continue
    try {
      const r = JSON.parse(line)
      if (r.kind === 'tool') continue // tool notes are not tied to a user message
      if (!bySession.has(r.session)) bySession.set(r.session, [])
      bySession.get(r.session).push(r)
    } catch {}
  }
  return bySession
}

// One indexer at a time across all open sessions; a stale lock (crashed run) is ignored.
function lock() {
  try {
    if (existsSync(LOCK_PATH)) {
      // A lock left by a run that was cut off (the mod reloading kills it) is cleared at once.
      const pid = Number(readFileSync(LOCK_PATH, 'utf8'))
      let alive = false
      try { process.kill(pid, 0); alive = true } catch {}
      if (!alive || Date.now() - statSync(LOCK_PATH).mtimeMs > 10 * 60e3) unlinkSync(LOCK_PATH)
    }
    writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' })
    return true
  } catch { return false }
}

// Per exact tool call (and per tool+file/url): how many times it worked or failed, the last error,
// plus every lesson with the tools it mentions. Small on purpose: read before each tool call.
export function buildToolIndex(mem, cold) {
  const exact = {}, loose = {}, lessons = [], tools = {}
  const corr = loadCorrections()
  const tick = (map, key, ok, err, ts, project) => {
    const e = (map[key] ??= { ok: 0, fail: 0 })
    ok ? e.ok++ : e.fail++
    if (!ok) { e.err = err; e.errTs = ts }
    e.last = ok ? 'ok' : 'fail'
    e.ts = ts
    e.project = project
  }
  for (const store of [mem, cold]) {
    if (!store) continue
    for (const call of store.pool('tool_call').list()) {
      if (call.metadata.tool?.startsWith('mcp__session-memory__')) continue
      const res = call.metadata.result && (mem.get(call.metadata.result) ?? cold?.get(call.metadata.result))
      if (!res) continue
      const ok = res.pool === 'success'
      if (!ok && HARNESS_ERROR.test(res.content ?? '')) continue // not the call's fault
      const err = ok ? '' : (res.content ?? '').replace(/^[^:]*: /, '').replace(/\s+/g, ' ').slice(0, 160)
      tick(exact, call.content, ok, err, call.metadata.ts, call.metadata.project)
      const tt = (tools[call.metadata.tool] ??= { ok: 0, fail: 0 })
      ok ? tt.ok++ : tt.fail++
      const t = call.metadata.target
      if (t && call.metadata.tool !== 'Bash') tick(loose, `${call.metadata.tool}|${t}`, ok, err, call.metadata.ts, call.metadata.project)
    }
    for (const l of store.pool('lesson').list()) {
      if (corr[l.id]?.forget) continue // Claude corrected memory: this lesson is not to be shown
      const text = corr[l.id]?.fix ?? l.content ?? ''
      const tools = [...new Set(text.match(/mcp__[\w-]+__[\w-]+|\b(?:Bash|Edit|Write|Read|Grep|Glob|WebFetch|WebSearch)\b/g) ?? [])]
      lessons.push({ id: l.id, text: text.replace(/\s+/g, ' ').slice(0, 300), project: l.metadata.project, tools })
    }
  }
  return { built: Date.now(), exact, loose, lessons, tools }
}

export async function indexAll({ log = () => {} } = {}) {
  ensureHome()
  if (!lock()) return { busy: true }
  try {
    const cfg = loadConfig()
    const state = loadState()
    state.sigs ??= {}
    state.cold ??= {} // id -> pool, for everything in cold storage
    // Cold storage is only opened when something needs to move in or out of it.
    let cold = null, coldDirty = false, movedCold = 0, warmed = 0
    const getCold = () => (cold ??= openCold())
    // Liminal's own eviction hook: a node leaving active memory lands in cold storage, whole.
    const mem = openMemory({
      onEvict: async nodes => {
        for (const n of nodes) {
          if (!getCold().has(n.id)) await getCold().pool(n.pool).create({ id: n.id, content: n.content, metadata: n.metadata })
          state.cold[n.id] = n.pool
          movedCold++
        }
        coldDirty = true
      },
    })
    // Brings a cold memory back into active memory when it is used again. Its strength history comes
    // with it; the reuse that brought it back is what raises it.
    const ensureActive = async id => {
      if (mem.has(id)) return true
      const pool = state.cold[id]
      if (!pool) return false
      const n = getCold().get(id)
      if (!n) { delete state.cold[id]; return false }
      getCold().pool(pool).remove(id)
      await mem.pool(pool).create({ id, content: n.content, metadata: n.metadata })
      delete state.cold[id]
      coldDirty = true
      warmed++
      return true
    }
    const recalls = loadRecalls()
    let files = 0, lines = 0, made = 0
    for (const t of transcripts(cfg)) {
      const size = statSync(t.path).size
      let off = state.files[t.path]?.off ?? 0
      if (off >= size) continue
      files++
      const key = t.helper ? `${t.session}/${t.helper}` : t.session
      const st = (state.sessions[key] ??= {})
      const ctx = { mem, cfg, session: t.session, helper: t.helper, st, recalls, sigs: state.sigs, ensureActive, src: '' }
      const fd = openSync(t.path, 'r')
      const buf = Buffer.alloc(CHUNK)
      let carry = Buffer.alloc(0)
      let lineNo = state.files[t.path]?.lines ?? 0
      try {
        while (true) {
          const n = readSync(fd, buf, 0, CHUNK, off)
          if (n === 0) break
          const data = Buffer.concat([carry, buf.subarray(0, n)])
          const lastNl = data.lastIndexOf(10)
          off += n
          if (lastNl === -1) { carry = data; continue }
          carry = data.subarray(lastNl + 1)
          for (const line of data.subarray(0, lastNl).toString('utf8').split('\n')) {
            lineNo++
            if (!line) continue
            ctx.src = `${t.dir}/${t.helper ? `${t.session}/subagents/agent-${t.helper}` : t.session}.jsonl:${lineNo}`
            lines++
            made += await processLine(ctx, line)
          }
        }
        // Consumed only up to the last complete line; a half-written last line is read next time.
        state.files[t.path] = { off: off - carry.length, lines: lineNo }
      } catch (e) {
        log(`error in ${t.path}: ${e.stack || e.message}`)
      } finally { closeSync(fd) }
    }
    // Claude's explicit marks (wrong answer, frustrated, worked, lesson, important).
    const marked = await applyMarks({ mem, state, ensureActive })
    // Fading: memories that are old and have lost their strength move to cold storage. Checked at
    // most once an hour; nothing is deleted.
    const now = Date.now()
    if (now - (state.lastSweep ?? 0) > 60 * 60e3) {
      state.lastSweep = now
      for (const p of CONTENT_POOLS) {
        const faded = mem.pool(p).list().filter(n => now - (n.metadata.ts || 0) > cfg.coldAfterDays * 864e5 && strengthOf(n.metadata, now) < cfg.coldBelow).map(n => n.id)
        if (faded.length) await mem.pool(p).evict(faded)
      }
    }
    if (files > 0 || movedCold || warmed || marked) { saveMemory(mem); saveState(state) }
    if (coldDirty) saveCold(cold)
    if (files > 0 || movedCold || warmed || marked) saveToolIndex(buildToolIndex(mem, cold ?? (state.cold && Object.keys(state.cold).length ? openCold() : null)))
    const nodes = Object.fromEntries(POOLS.map(p => [p, mem.pool(p).size]).filter(([, n]) => n > 0))
    const fixes = mem.pool('failure').list().filter(n => n.metadata.fixedBy).length
    const strengthened = POOLS.reduce((a, p) => a + mem.pool(p).list().filter(n => n.metadata.reuses).length, 0)
    const summary = { at: new Date().toISOString(), filesRead: files, linesRead: lines, nodesAdded: made, nodes, cold: Object.keys(state.cold).length, movedToCold: movedCold, warmedBack: warmed, marksApplied: marked, fixes, strengthened }
    writeFileSync(LAST_INDEX_PATH, JSON.stringify(summary))
    return summary
  } finally {
    try { unlinkSync(LOCK_PATH) } catch {}
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now()
  const r = await indexAll({ log: m => console.error(m) })
  // Then the local embeddings for anything new (quietly nothing when the local model is not running).
  // A short budget per run: it carries on next time, so a big first backfill spreads over a few runs.
  try { const { embedMissing } = await import('./embed.mjs'); r.embeddings = await embedMissing({ budgetMs: 6000 }) } catch {}
  console.log(JSON.stringify({ ...r, seconds: (Date.now() - t0) / 1000 }))
}
