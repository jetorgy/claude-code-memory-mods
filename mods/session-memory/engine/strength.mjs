// Homeostatic strength, ported from darkmind's app/memory/bridge-strength.mjs:
// reuse pushes a memory's strength up, real elapsed time pulls it back toward a resting
// baseline (never to zero, never locked), and the baseline only creeps up after sustained
// reuse. A real "that was wrong" signal subtracts the same step a reuse adds.
// Here it works on any node's metadata instead of darkmind's bridge pools.
export const REINFORCE_STEP = 0.15
export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000
export const CRYSTALLIZE_INTERVAL = 20
export const BASELINE_STEP = 0.05
export const BASELINE_MAX = 0.6

const decayFactor = (elapsedMs, priority = 1) => Math.pow(0.5, elapsedMs / (HALF_LIFE_MS * priority))

/** Current strength 0..1 of a node, computed lazily from its metadata. 0 if never touched. */
export function strengthOf(meta, now = Date.now()) {
  if (!meta?.lastTouched) return 0
  const baseline = meta.baseline ?? 0
  return baseline + ((meta.strength ?? 0) - baseline) * decayFactor(Math.max(0, now - meta.lastTouched), meta.priority ?? 1)
}

/** A real reuse: settle to where it has decayed to, then add one step. */
export function reinforce(meta, now = Date.now()) {
  const settled = strengthOf(meta, now)
  meta.reuses = (meta.reuses ?? 0) + 1
  meta.strength = Math.min(1, settled + REINFORCE_STEP)
  meta.lastTouched = now
  const baseline = meta.baseline ?? 0
  if (meta.reuses % CRYSTALLIZE_INTERVAL === 0 && baseline < BASELINE_MAX) meta.baseline = Math.min(BASELINE_MAX, baseline + BASELINE_STEP)
}

/** The exact inverse of a reuse, only for a real human "that was wrong". Never raises the baseline. */
export function penalize(meta, now = Date.now()) {
  meta.strength = Math.max(0, strengthOf(meta, now) - REINFORCE_STEP)
  meta.lastTouched = now
  meta.penalties = (meta.penalties ?? 0) + 1
}
