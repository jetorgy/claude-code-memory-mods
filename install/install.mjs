#!/usr/bin/env node
// Installer for the Claude Code memory mods. Plain Node, no dependencies, nothing hidden.
//
//   node install/install.mjs                 install the mods and import your existing sessions
//   node install/install.mjs --dry-run       show every step, change nothing
//   node install/install.mjs --no-import     install but do not read old sessions yet
//   node install/install.mjs --autocompact   also set Claude Code's own 150000-token compaction safety net
//   node install/install.mjs --local-check   report whether this machine can run the optional local model (changes nothing)
//   node install/install.mjs --pull-model    download the local models (gemma4:e4b, about 9.6 GB, and nomic-embed-text, about 274 MB) into its own private Ollama
//   node install/install.mjs --uninstall     take the mods out of settings and delete the installed code (keeps your memory, logs and local-model settings)
//   node install/install.mjs --uninstall --delete-data    ...and also delete the memory database, logs and local-model settings
//   node install/install.mjs --claude-home DIR            use DIR instead of ~/.claude (for testing)
//
// What it writes (nothing else): <claude home>/my-mods/*, <claude home>/flight-recorder, <claude home>/local-llm,
// <claude home>/session-memory (the memory itself), and ONE merged key in <claude home>/settings.json
// (env.CLAUDE_CODE_PLUGIN_DIRS, plus autoCompactWindow only with --autocompact). It backs settings.json up first.
// It never installs Ollama and never downloads anything unless you pass --pull-model.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, copyFileSync, rmSync, realpathSync, rmdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const has = k => args.includes(k)
const val = k => {
  const i = args.indexOf(k)
  if (i === -1) return undefined
  const v = args[i + 1]
  if (v === undefined || v.startsWith('-')) { console.error(`${k} needs a value`); process.exit(2) }
  return v
}
const DRY = has('--dry-run')
const CLAUDE_HOME = resolve(val('--claude-home') || process.env.CLAUDE_HOME_DIR || join(homedir(), '.claude'))
const MODS = ['session-memory', 'model-selector', 'subagent-router', 'research']
const MODS_DIR = join(CLAUDE_HOME, 'my-mods')
const SETTINGS = join(CLAUDE_HOME, 'settings.json')
const MEMORY_HOME = process.env.SESSION_MEMORY_HOME || join(CLAUDE_HOME, 'session-memory')
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

let problems = 0
const say = (tag, msg) => console.log(`${tag.padEnd(7)} ${msg}`)
const ok = m => say('[ok]', m)
const skip = m => say('[skip]', m)
const warn = m => { say('[warn]', m) }
const fail = m => { problems++; say('[FAIL]', m) }
const act = (what, fn) => { if (DRY) return say('[dry]', what); fn() }

const run = (cmd, a, opts = {}) => spawnSync(cmd, a, { encoding: 'utf8', ...opts })
const which = name => {
  for (const d of (process.env.PATH || '').split(delimiter)) { const p = join(d, name); if (existsSync(p)) return p }
  return undefined
}

// ---------- helpers ----------
const SKIP_NAMES = new Set(['node_modules', 'log.jsonl', 'log.old.jsonl', 'config.env', '.git'])
function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, base, out)
    else if (e.isFile()) out.push(p.slice(base.length + 1))
  }
  return out.sort()
}
const hashOf = p => createHash('sha256').update(readFileSync(p)).digest('hex')
function sameTree(a, b) {
  if (!existsSync(a) || !existsSync(b)) return false
  const fa = walk(a), fb = walk(b)
  return fa.length === fb.length && fa.every((f, i) => f === fb[i] && hashOf(join(a, f)) === hashOf(join(b, f)))
}
function copyTree(src, dst) {
  for (const f of walk(src)) {
    mkdirSync(dirname(join(dst, f)), { recursive: true })
    copyFileSync(join(src, f), join(dst, f))
  }
}
// Installs src into dst. An existing, different copy is moved aside (never deleted), a matching one is left alone.
function place(label, src, dst) {
  if (sameTree(src, dst)) return skip(`${label} already up to date`)
  act(`install ${label} -> ${dst}`, () => {
    if (existsSync(dst)) {
      // keep node_modules and user files out of the comparison but do not lose them
      const aside = `${dst}.bak-${stamp}`
      renameSync(dst, aside)
      say('[ok]', `previous ${label} kept as ${aside}`)
      copyTree(src, dst)
      // Files that belong to the user, not the code (logs, settings, the installed library) stay where they were.
      for (const keep of SKIP_NAMES) {
        if (keep === '.git' || !existsSync(join(aside, keep))) continue
        renameSync(join(aside, keep), join(dst, keep))
      }
    } else copyTree(src, dst)
    ok(`installed ${label}`)
  })
}
function findClaude() {
  const onPath = which('claude')
  if (onPath) return onPath
  const guesses = [join(homedir(), '.local', 'bin', 'claude')]
  const app = join(homedir(), '.config', 'Claude', 'claude-code')
  try {
    for (const v of readdirSync(app)) for (const h of readdirSync(join(app, v))) guesses.push(join(app, v, h, 'claude'))
  } catch {}
  return guesses.find(p => existsSync(p))
}

// ---------- settings.json ----------
function readSettings() {
  if (!existsSync(SETTINGS)) return {}
  const text = readFileSync(SETTINGS, 'utf8')
  try { return JSON.parse(text || '{}') } catch (e) { throw new Error(`${SETTINGS} is not valid JSON (${e.message}); fix or remove it, then run again. Nothing was changed.`) }
}
function writeSettings(obj) {
  mkdirSync(CLAUDE_HOME, { recursive: true })
  // If settings.json is a symlink (dotfiles managers), write through it instead of replacing the link.
  let target = SETTINGS
  try { target = realpathSync(SETTINGS) } catch {}
  if (existsSync(target)) {
    let bak = `${SETTINGS}.bak-pre-memory-mods-${stamp}`
    for (let n = 2; existsSync(bak); n++) bak = `${SETTINGS}.bak-pre-memory-mods-${stamp}-${n}`
    copyFileSync(target, bak)
  }
  const tmp = `${target}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`)
  renameSync(tmp, target)
}
const modPaths = () => MODS.map(m => join(MODS_DIR, m))

// ---------- steps ----------
function preflight() {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 18) { fail(`Node ${process.versions.node} is too old; need 18 or newer.`); return false }
  ok(`Node ${process.versions.node}`)
  if (!which('npm')) { fail('npm was not found; it is needed once to install the memory library.'); return false }
  ok('npm found')
  if (!existsSync(join(REPO, 'mods', 'session-memory', 'engine'))) { fail(`this does not look like the repo (no mods/ in ${REPO})`); return false }
  ok(`repo at ${REPO}`)
  say('[info]', `claude home: ${CLAUDE_HOME}${DRY ? '   (DRY RUN: nothing will change)' : ''}`)
  return true
}

function installFiles() {
  for (const m of MODS) place(`mod ${m}`, join(REPO, 'mods', m), join(MODS_DIR, m))
  place('flight recorder', join(REPO, 'extras', 'flight-recorder'), join(CLAUDE_HOME, 'flight-recorder'))
  place('local model launcher', join(REPO, 'extras', 'local-llm'), join(CLAUDE_HOME, 'local-llm'))
  act('make the launcher executable', () => { try { spawnSync('chmod', ['+x', join(CLAUDE_HOME, 'local-llm', 'ensure.sh')]) } catch {} })
}

function installDeps() {
  const dir = join(MODS_DIR, 'session-memory')
  if (!DRY && existsSync(join(dir, 'node_modules', '@automacene', 'liminal-memory'))) return skip('memory library already installed')
  act('npm install in session-memory (the @automacene/liminal-memory library, pinned in package.json)', () => {
    const r = run('npm', ['install', '--no-audit', '--no-fund', '--omit=dev'], { cwd: dir, stdio: 'inherit' })
    if (r.status === 0) ok('memory library installed')
    else fail('npm install failed (see the output above)')
  })
}

function mergeSettings() {
  let s
  try { s = readSettings() } catch (e) { return fail(e.message) }
  const have = (s.env?.CLAUDE_CODE_PLUGIN_DIRS || '').split(delimiter).filter(Boolean)
  const want = modPaths().filter(p => !have.includes(p))
  const next = JSON.parse(JSON.stringify(s))
  if (want.length) {
    next.env = { ...(next.env || {}), CLAUDE_CODE_PLUGIN_DIRS: [...have, ...want].join(delimiter) }
  }
  const wantCompact = has('--autocompact') && next.autoCompactWindow === undefined
  if (wantCompact) next.autoCompactWindow = 150000
  if (!want.length && !wantCompact) return skip('settings.json already lists the mods')
  act(`merge into ${SETTINGS}: ${want.length ? `env.CLAUDE_CODE_PLUGIN_DIRS += ${want.length} mod folder(s)` : ''}${wantCompact ? ' autoCompactWindow=150000' : ''} (backup first)`, () => {
    writeSettings(next)
    ok('settings.json updated (backup saved next to it)')
  })
  if (has('--autocompact') && s.autoCompactWindow !== undefined) skip(`autoCompactWindow already set (${s.autoCompactWindow}); left as is`)
}

function validate() {
  const claude = findClaude()
  for (const m of MODS) {
    const dir = join(MODS_DIR, m)
    if (DRY || !existsSync(dir)) continue
    if (!claude) { warn('the claude program was not found, so `claude plugin validate` was skipped'); break }
    const r = run(claude, ['plugin', 'validate', dir])
    const text = `${r.stdout || ''}${r.stderr || ''}`
    if (r.status === 0 && /passed/i.test(text)) ok(`validate ${m}: passed`)
    else fail(`validate ${m}: ${text.trim().split('\n').slice(-3).join(' | ')}`)
  }
  // The validator only checks hooks/register.ts. A script that cannot run would otherwise fail silently, so run them.
  const eng = join(MODS_DIR, 'session-memory', 'engine')
  if (DRY || !existsSync(eng)) return
  const env = { ...process.env, SESSION_MEMORY_HOME: MEMORY_HOME }
  for (const [file, a] of [['window.mjs', ['--status']], ['recall.mjs', ['--q', 'installer smoke test']], ['active.mjs', []], ['embed.mjs', ['--status']]]) {
    const r = run('node', ['--no-warnings', join(eng, file), ...a], { env, cwd: eng, timeout: 60000 })
    if (r.status === 0) ok(`engine/${file} runs`)
    else fail(`engine/${file} did not run: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' | ')}`)
  }
  // The GPU watcher: one look, no side effects unless the GPU is full and the mods' own model is loaded.
  const w = run('node', ['--no-warnings', join(MODS_DIR, 'model-selector', 'engine', 'gpuwatch.mjs'), '--once'], { env: { ...env, CLAUDE_HOME }, timeout: 20000 })
  if (w.status === 0) ok('model-selector/engine/gpuwatch.mjs runs')
  else fail(`gpuwatch.mjs did not run: ${(w.stderr || w.stdout || '').trim().split('\n').slice(-2).join(' | ')}`)
}

function importSessions() {
  if (has('--no-import')) return skip('session import (--no-import)')
  const projects = process.env.CLAUDE_PROJECTS_DIR || join(CLAUDE_HOME, 'projects')
  if (!existsSync(projects)) return skip(`no saved sessions yet (${projects}); the memory fills as you work`)
  act(`read every saved session in ${projects} into the memory (read-only on your transcripts)`, () => {
    const r = run('node', ['--no-warnings', join(MODS_DIR, 'session-memory', 'engine', 'index.mjs')], {
      env: { ...process.env, SESSION_MEMORY_HOME: MEMORY_HOME, CLAUDE_PROJECTS_DIR: projects }, stdio: 'inherit', cwd: join(MODS_DIR, 'session-memory', 'engine'),
    })
    if (r.status === 0) ok('existing sessions imported')
    else fail('session import failed (see the output above)')
    // Semantic recall: embed the imported memory with the local embedding model, if it is already running.
    // Nothing is started or downloaded here; without it, recall is keyword-only and fills in later.
    const e = run('node', ['--no-warnings', join(MODS_DIR, 'session-memory', 'engine', 'embed.mjs')], {
      env: { ...process.env, SESSION_MEMORY_HOME: MEMORY_HOME }, cwd: join(MODS_DIR, 'session-memory', 'engine'), timeout: 300000,
    })
    let n = {}
    try { n = JSON.parse((e.stdout || '').trim().split('\n').pop()) } catch {}
    n.total ? ok(`semantic recall: ${n.total} memories embedded locally`) : say('[info]', `semantic recall is not active yet (the local embedding model is not running). Recall uses keywords until it is; see SETUP-PROMPT.md step 5.`)
  })
}

// ---------- optional local model ----------
const OLLAMA_HOST = '127.0.0.1:11435'
const MODEL = 'gemma4:e4b'
const EMBED_MODEL = 'nomic-embed-text' // about 274 MB; makes recall work by meaning as well as by keyword
function ollamaBin() {
  return which('ollama') || ['/usr/local/bin/ollama', '/usr/bin/ollama', join(homedir(), '.local', 'bin', 'ollama')].find(p => existsSync(p))
}
function localCheck() {
  say('[info]', 'local model check (changes nothing)')
  const bin = ollamaBin()
  bin ? ok(`Ollama found at ${bin}`) : warn('Ollama is not installed. The mods work without it (they use Haiku for the small jobs). To add it, install Ollama yourself from https://ollama.com/download and run this again.')
  const g = run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'])
  if (g.status === 0 && g.stdout.trim()) {
    const [name, mem] = g.stdout.trim().split('\n')[0].split(',').map(x => x.trim())
    const mb = Number(String(mem).replace(/[^0-9]/g, ''))
    ok(`GPU: ${name}, ${mem}`)
    mb >= 11500 ? ok('enough GPU memory to hold the whole model: every layer will be placed on the GPU') : warn(`only ${mem} of GPU memory: Ollama will split the model between the GPU and the CPU/RAM by itself (slower but works)`)
  } else warn('no NVIDIA GPU found. The model would run on the CPU (slow); the mods will mostly use Haiku instead.')
  const df = run('df', ['-Pk', homedir()])
  const freeGb = df.status === 0 ? Math.round(Number(df.stdout.trim().split('\n')[1].split(/\s+/)[3]) / 1048576) : undefined
  if (freeGb !== undefined) (freeGb >= 15 ? ok : warn)(`free disk in your home folder: about ${freeGb} GB (the model needs about 10 GB)`)
  const t = run('curl', ['-s', '-m', '2', `http://${OLLAMA_HOST}/api/tags`])
  if (t.status === 0 && t.stdout.includes(`"${MODEL}"`)) ok(`${MODEL} is already downloaded in the private server`)
  else say('[info]', `${MODEL} is not downloaded yet. To get it: node install/install.mjs --pull-model   (about 9.6 GB, from Ollama's library)`)
  if (t.status === 0 && t.stdout.includes(`"${EMBED_MODEL}`)) ok(`${EMBED_MODEL} is already downloaded: recall works by meaning too`)
  else say('[info]', `${EMBED_MODEL} (about 274 MB) is not downloaded yet; --pull-model gets it. Without it recall uses keywords only.`)
}
function pullModel() {
  const bin = ollamaBin()
  if (!bin) return fail('Ollama is not installed. Install it yourself from https://ollama.com/download first, then run --pull-model again.')
  const ensure = join(CLAUDE_HOME, 'local-llm', 'ensure.sh')
  if (!existsSync(ensure)) return fail('the launcher is not installed yet; run the plain install first.')
  act(`start the private Ollama on ${OLLAMA_HOST}, then download ${MODEL} (about 9.6 GB) and ${EMBED_MODEL} (about 274 MB)`, () => {
    const e = run('bash', [ensure])
    const last = (e.stdout || '').trim().split('\n').pop()
    if (!/^(up|started)$/.test(last)) return fail(`could not start the private Ollama: ${last}`)
    for (const m of [MODEL, EMBED_MODEL]) {
      const r = run(bin, ['pull', m], { env: { ...process.env, OLLAMA_HOST }, stdio: 'inherit' })
      r.status === 0 ? ok(`${m} downloaded`) : fail(`the download of ${m} failed (see the output above)`)
    }
  })
}

// ---------- uninstall ----------
// Stops the GPU watcher if one is running (it would otherwise outlive the files it runs from).
function stopWatcher() {
  const pidFile = join(CLAUDE_HOME, 'local-llm', 'gpuwatch.pid')
  try {
    const pid = Number(readFileSync(pidFile, 'utf8'))
    if (pid > 1) { process.kill(pid, 'SIGTERM'); ok(`stopped the GPU watcher (pid ${pid})`) }
  } catch {}
}
// Deletes only the files this installer put in a folder, then the folder if nothing else is left in it.
function removeInstalledFiles(srcDir, dstDir) {
  for (const f of walk(srcDir)) rmSync(join(dstDir, f), { force: true })
  try { rmdirSync(dstDir) } catch {} // fails (and is left alone) if your logs or settings are still in it
}
// --delete-data removes a whole folder, so refuse anything that does not look like this tool's own memory folder.
function safeToDeleteMemory() {
  const d = resolve(MEMORY_HOME)
  if (d === '/' || d === resolve(homedir()) || d === CLAUDE_HOME) return false
  return existsSync(join(d, 'memory.json')) || existsSync(join(d, 'config.json')) || d === join(CLAUDE_HOME, 'session-memory')
}
function uninstall() {
  let s
  try { s = readSettings() } catch (e) { return fail(e.message) }
  const mine = new Set(modPaths())
  const keep = (s.env?.CLAUDE_CODE_PLUGIN_DIRS || '').split(delimiter).filter(p => p && !mine.has(p))
  const next = JSON.parse(JSON.stringify(s))
  if (next.env) { keep.length ? (next.env.CLAUDE_CODE_PLUGIN_DIRS = keep.join(delimiter)) : delete next.env.CLAUDE_CODE_PLUGIN_DIRS; if (!Object.keys(next.env).length) delete next.env }
  if (JSON.stringify(next) === JSON.stringify(s)) skip('settings.json does not list the mods')
  else act('remove the mods from settings.json (backup first)', () => { writeSettings(next); ok('settings.json updated') })
  act('stop the GPU watcher if it is running', stopWatcher)
  for (const m of MODS) act(`delete ${join(MODS_DIR, m)}`, () => rmSync(join(MODS_DIR, m), { recursive: true, force: true }))
  const wipe = has('--delete-data')
  for (const [d, src] of [['flight-recorder', 'flight-recorder'], ['local-llm', 'local-llm']]) {
    const dst = join(CLAUDE_HOME, d)
    if (wipe) act(`delete ${dst} (including its logs and settings)`, () => rmSync(dst, { recursive: true, force: true }))
    else act(`delete the installed scripts in ${dst} (your logs and config.env stay)`, () => removeInstalledFiles(join(REPO, 'extras', src), dst))
  }
  if (wipe) {
    if (!safeToDeleteMemory()) return fail(`refusing to delete ${MEMORY_HOME}: it does not look like a memory folder (no memory.json or config.json in it)`)
    act(`delete the memory database ${MEMORY_HOME}`, () => rmSync(MEMORY_HOME, { recursive: true, force: true }))
  } else say('[info]', `your memory, logs and local-model settings are kept (add --delete-data to remove them); memory is at ${MEMORY_HOME}`)
}

// ---------- main ----------
if (has('--local-check')) { localCheck(); process.exit(0) }
if (has('--uninstall')) { uninstall(); process.exit(problems ? 1 : 0) }
if (has('--pull-model')) { pullModel(); process.exit(problems ? 1 : 0) }
if (!preflight()) process.exit(1)
installFiles()
installDeps()
mergeSettings()
validate()
importSessions()
console.log('')
if (problems) { console.log(`Finished with ${problems} problem(s). Fix them, then run this again: it is safe to repeat.`); process.exit(1) }
console.log(DRY ? 'Dry run finished: nothing was changed.' : 'Installed. In Claude Code run /reload-plugins to switch the mods on.')
