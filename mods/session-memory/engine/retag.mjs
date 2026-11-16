#!/usr/bin/env node
// Re-tags research nodes into short, stable category paths (rule table, no model).
//   node retag.mjs [--apply]   (default: dry run, prints old -> new with node counts)
// Rules run in order; the first whose regex matches the old path (case-insensitive) wins.
import { openMemory, saveMemory } from './store.mjs'

const RULES = [
  [/smoke-test/, 'research/test'],
  [/stage-gates|research-mod|stopping-r/, 'research/method/research-process'],
  [/plateau|reward hacking|repeats|stochastic/, 'research/evolution/evaluation-and-fitness'],
  [/bandit|adaevolve|deliberate evolution/, 'research/evolution/operator-selection'],
  [/map-elites|qdaif|quality-diversity/, 'research/evolution/quality-diversity'],
  [/node preservation/, 'research/evolution/cgp'],
  [/llm|elm|crossover|evolutionary-search/, 'research/evolution/llm-operators'],
  [/grammar-guided/, 'research/evolution/genotype'],
  [/cartesian|cgp|kalkreuth|semantic mutation|node preservation/, 'research/evolution/cgp'],
  [/csg|shapeassembly|shape programs|library learning|dreamcoder/, 'research/cad/shape-programs'],
  [/cad|text2cad|itercad|cadsmith|ai agents/, 'research/cad/agents'],
]
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

const apply = process.argv.includes('--apply')
const mem = openMemory()
const nodes = mem.pool('research').list().filter(n => n && n.content)
const tally = new Map()
let changed = 0
for (const n of nodes) {
  const md = n.metadata || (n.metadata = {})
  const old = String(md.path || `research/${md.topic || ''}`)
  const hit = RULES.find(([re]) => re.test(old.toLowerCase()))
  const next = hit ? hit[1] : `research/other/${slug(old.replace(/^research\//, '')) || 'misc'}`
  if (!md.why) md.why = `gathered for: ${md.rproject || md.topic || old}`.slice(0, 200)
  if (md.oldPath === undefined && next !== old) md.oldPath = old
  if (next !== old) { md.path = next; changed++ }
  const k = `${old}  ->  ${next}`
  tally.set(k, (tally.get(k) || 0) + 1)
}
for (const [k, c] of [...tally].sort()) console.log(`${String(c).padStart(4)}  ${k}`)
console.log(`${nodes.length} nodes, ${changed} re-pathed${apply ? ' (saved)' : ' (dry run; --apply to save)'}`)
if (apply) saveMemory(mem)
