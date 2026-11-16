#!/usr/bin/env node
// Research pool map: categories (topic paths), summaries, bridges between categories, query log with repeat check.
//   node research-map.mjs map [--path P]        category summaries + bridges ("aha" links), each naming source nodes
//   node research-map.mjs query "<text>" [--log] warn when a similar query was already run; --log records it
//   node research-map.mjs aha "<task text>"     one line: research categories that touch this task
import { appendFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { openMemory, HOME } from './store.mjs'

const QLOG = join(HOME, 'research-queries.jsonl')
const STOP = new Set('the a an and or of to in on for with is are was were be by as at it this that from which can not but have has had their its than then into more most such also these those using used use may our we they them his her one two per via over under between within without about when what how why who whom'.split(' '))
const CHAT = new Set('intended doing does work works working yes fix both want please thing things make made show check tested test tell sure like need needs just still really actually keep going continue before after again maybe about'.split(' '))
const isNote = src => /\b(evidence|notebook|question|protocol|queries|report)\.md\b/i.test(String(src))
const terms = t => (String(t).toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []).filter(w => !STOP.has(w) && !CHAT.has(w))

function nodes() {
  return openMemory().pool('research').list().filter(n => n && n.content)
}

function build() {
  const cats = new Map()
  for (const n of nodes()) {
    const m = n.metadata || {}
    const path = m.path || `research/${m.topic || 'uncategorised'}`
    const c = cats.get(path) || { path, n: 0, tf: new Map(), sources: new Map(), whys: new Set(), byTerm: new Map() }
    c.n++
    if (m.source) c.sources.set(m.source, (c.sources.get(m.source) || 0) + 1)
    if (m.why) c.whys.add(m.why)
    for (const w of new Set(terms(n.content))) {
      c.tf.set(w, (c.tf.get(w) || 0) + 1)
      if (!c.byTerm.has(w)) c.byTerm.set(w, m.source || n.id)
    }
    cats.set(path, c)
  }
  return [...cats.values()]
}

// Meaning-based bridges: pairs of nodes from different categories and sources whose local embeddings
// (embed.mjs, nomic) are close, i.e. same idea in different words. Empty when vectors are unavailable.
async function semanticBridges(only) {
  const { loadVectors } = await import('./embed.mjs')
  const v = loadVectors()
  if (!v) return []
  const ns = nodes().filter(n => v.row.has(n.id))
  const info = n => { const m = n.metadata || {}; return { id: n.id, path: m.path || `research/${m.topic || 'uncategorised'}`, src: m.source || n.id, row: v.row.get(n.id) } }
  const L = ns.map(info), best = new Map()
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const a = L[i], b = L[j]
    if (a.path === b.path || a.src === b.src || isNote(a.src) || isNote(b.src)) continue
    if (only && !a.path.startsWith(only) && !b.path.startsWith(only)) continue
    let dot = 0
    for (let k = 0; k < v.dim; k++) dot += v.data[a.row * v.dim + k] * v.data[b.row * v.dim + k]
    if (dot < 0.85) continue
    const key = [a.path, b.path].sort().join('|')
    if (!best.has(key) || best.get(key).dot < dot) best.set(key, { a, b, dot })
  }
  return [...best.values()].sort((x, y) => y.dot - x.dot).slice(0, 12).map(({ a, b, dot }) => `- ${a.path} <-> ${b.path}: cos ${dot.toFixed(2)} (${a.src} / ${b.src})`)
}

function report(only) {
  const cats = build()
  const df = new Map()
  for (const c of cats) for (const w of c.tf.keys()) df.set(w, (df.get(w) || 0) + 1)
  const N = cats.length || 1
  const score = (c, w) => c.tf.get(w) * Math.log(1 + N / df.get(w))
  const out = []
  for (const c of cats) {
    if (only && !c.path.startsWith(only)) continue
    const top = [...c.tf.keys()].filter(w => c.tf.get(w) >= 2).sort((a, b) => score(c, b) - score(c, a)).slice(0, 12)
    out.push(`## ${c.path}  (${c.n} nodes, ${c.sources.size} sources)`, `Key terms: ${top.join(', ')}`, `Why gathered: ${[...c.whys].slice(0, 3).join(' | ') || '(not recorded)'}`, `Top sources: ${[...c.sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s]) => s).join(' ; ')}`, '')
  }
  out.push('## Bridges (terms strong in two categories; each names where it came from)')
  const seen = new Set()
  for (let i = 0; i < cats.length; i++) for (let j = i + 1; j < cats.length; j++) {
    const a = cats[i], b = cats[j]
    if (only && !a.path.startsWith(only) && !b.path.startsWith(only)) continue
    const shared = [...a.tf.keys()].filter(w => b.tf.has(w) && a.tf.get(w) >= 2 && b.tf.get(w) >= 2 && df.get(w) <= 2).sort((x, y) => score(a, y) + score(b, y) - score(a, x) - score(b, x)).slice(0, 5)
    if (shared.length < 2 || seen.has(a.path + b.path)) continue
    seen.add(a.path + b.path)
    out.push(`- ${a.path} <-> ${b.path}: ${shared.map(w => `"${w}" (${a.byTerm.get(w)} / ${b.byTerm.get(w)})`).join(', ')}`)
  }
  return out.join('\n')
}

const norm = q => [...new Set(terms(q))].sort()
function similar(q) {
  if (!existsSync(QLOG)) return null
  const a = norm(q)
  let best = null
  for (const l of readFileSync(QLOG, 'utf8').split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(l) } catch { continue }
    const b = norm(r.q), inter = a.filter(w => b.includes(w)).length, j = inter / (new Set([...a, ...b]).size || 1)
    if (j >= 0.6 && (!best || j > best.j)) best = { j, r }
  }
  return best
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'map') { const i = rest.indexOf('--path'); const only = i >= 0 ? rest[i + 1] : ''; const sem = await semanticBridges(only).catch(() => []); console.log(report(only) + (sem.length ? '\n## Semantic bridges (same idea, different words; local embeddings)\n' + sem.join('\n') : '')) }
else if (cmd === 'query') {
  const q = rest.filter(x => !x.startsWith('--')).join(' ')
  const s = similar(q)
  console.log(s ? `REPEAT: ${Math.round(s.j * 100)}% match with a query run ${s.r.ts}: "${s.r.q}". Its results are already in the research pool; search memory first.` : 'New query.')
  if (rest.includes('--log')) appendFileSync(QLOG, JSON.stringify({ ts: new Date().toISOString().slice(0, 10), q }) + '\n')
} else if (cmd === 'aha') {
  const text = rest.join(' ')
  const t = new Set(terms(text))
  const hits = build().map(c => ({ c, k: [...c.tf.keys()].filter(w => t.has(w) && c.tf.get(w) >= 2) })).filter(x => x.k.filter(w => w.length >= 6).length >= 2).sort((a, b) => b.k.length - a.k.length).slice(0, 3)
  const parts = hits.map(h => `${h.c.path} (${h.k.slice(0, 3).join(', ')})`)
  // Meaning match: embed the task (local nomic, 1.5 s cap) and add research categories whose nodes are close in meaning.
  try {
    const { embedQuery, nearest } = await import('./embed.mjs')
    const qv = text.length < 40 ? null : await Promise.race([embedQuery(text), new Promise(r => setTimeout(() => r(null), 1500))])
    const ids = new Map(nodes().map(n => { const m = n.metadata || {}; return [n.id, m.path || `research/${m.topic || 'uncategorised'}`] }))
    const seen = new Set(hits.map(h => h.c.path))
    for (const { id, cos } of qv ? nearest(qv, undefined, 60) : []) {
      const path = ids.get(id)
      if (!path || seen.has(path) || cos < 0.65 || seen.size >= 4) continue
      seen.add(path); parts.push(`${path} (similar meaning, cos ${cos.toFixed(2)})`)
    }
  } catch { /* keywords only */ }
  console.log(parts.length ? `Research on file touches this: ${parts.join('; ')}.` : '')
} else console.log('usage: map | query "<text>" [--log] | aha "<text>"')
