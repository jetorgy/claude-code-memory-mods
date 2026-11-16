# Why memories have a strength with these constants

One line: every memory has a strength from 0 to 1 that rises when it is reused and fades when it is not, so frequently useful memories surface first and stale ones sink without being deleted.

Related: [../session-memory/strength-and-forgetting.md](../session-memory/strength-and-crystallization.md), [../session-memory/recall.md](../session-memory/recall.md), [../reference/configuration.md](../reference/configuration.md), [recall-limits.md](recall-limits.md)

## The choice (from `mods/session-memory/engine/strength.mjs` and `store.mjs`)

| Constant | Value | Meaning |
|---|---|---|
| `REINFORCE_STEP` | 0.15 | strength gained each time a memory is actually reused |
| half-life | 7 days | strength decays halfway toward its baseline every 7 days |
| `CRYSTALLIZE_INTERVAL` | 20 | after 20 reuses the memory "crystallizes" |
| `BASELINE_STEP` | 0.05 | baseline raised on each crystallization |
| `BASELINE_MAX` | 0.6 | the baseline never rises above this |
| penalty | 0.15 | subtracted when you say a memory was wrong; never raises the baseline |
| `CREATION_STRENGTH` | 0.3 | a new memory starts here |
| Claude-written lessons | priority 3, strength 0.6 | start stronger |
| priority 2 | fades half as fast | |
| `coldAfterDays` | 14 | cold tier needs age over 14 days ... |
| `coldBelow` | 0.1 | ... AND strength under 0.1 |

## The problem it solves

Without any weighting, every old memory competes equally with this week's. After months the useful ones are buried under noise. Without any forgetting at all, search results fill with things that were true once and never mattered again. Strength is a cheap signal for "this has been useful before".

## Why decay goes toward a baseline, not toward zero

Decay moves strength toward the memory's baseline. The baseline starts low and only rises through crystallization (reuse 20 times). So something you keep needing becomes permanently harder to lose, while a memory used once fades to near its starting floor. Nothing falls to exactly 0, so any memory can still be found by a direct search; it just stops being pushed forward unasked.

## Why a penalty that cannot raise the baseline

A real "that was wrong" correction subtracts 0.15. It never touches the baseline, so a wrong memory cannot become more permanent by being corrected, and a memory cannot be both punished and promoted. The code counts a correction only when it is real, not when an assistant happened to use a negative word.

## Why cold storage deletes nothing

Cold means old and weak. Cold memories are still searchable, just scored x0.9 and left out of the default unasked recall. A reuse brings a cold memory back. Research nodes never go cold, because researched sources are meant to be a lasting pool. Nothing is deleted, so the policy is reversible: a bad threshold costs ranking quality, not data.

## Why these numbers

Evidence level: the values are from the code. The reasons are inference, not verified.

- The 7-day half-life and +0.15 step match what the repo's own `docs/HOW-IT-WORKS.md` says, so doc and code agree. The reason for these exact figures is not written anywhere and nothing in the owner's session history explains them. A reasonable reading: a week matches the rhythm of project work, and +0.15 means a handful of reuses lifts a new memory (0.3) near the top. That reading is a guess.
- The design (reinforce, decay, crystallize) follows the Liminal memory library the mod is built on. Whether these numbers were copied from it or tuned is not recorded here.
- No test in the repo shows these values beat others. The owner has not measured retrieval quality (see [vibe-coded-and-limits.md](vibe-coded-and-limits.md)).

## How strength affects ranking

Final score is multiplied by `0.8 + 0.4 * strength`, so strength moves a result between x0.8 (strength 0) and x1.2 (strength 1). It nudges but cannot override relevance: a strong irrelevant memory still loses to a weak relevant one. See [recall-limits.md](recall-limits.md) for the other multipliers.

## Alternatives and trade-offs

- No decay: simple, but the pool becomes cluttered.
- Hard deletion after N days: saves space, loses data on a guess. Rejected by design here (nothing is deleted).
- Faster half-life: recent work dominates; long-dormant but important memories vanish from view sooner.
- Slower half-life: more stable, but stale material lingers.
- Trade-off of baselines: a memory that crystallized stays favoured even if it is later wrong; only a penalty reduces it, and it will not lower the baseline.

## How to change it

Edit the constants at the top of `strength.mjs` (and `coldAfterDays`, `coldBelow` in the config defaults in `store.mjs`, or in the config file, see [../reference/configuration.md](../reference/configuration.md)). Existing strengths are not rewritten: new constants apply from the next decay or reinforcement.
