# Strength and crystallization

Each memory has a strength that fades with time, rises when it is useful, drops when it misleads, and moves to cold storage when it is stale.

Related: [Reading sessions](reading-sessions.md) | [Recall](recall.md) | [Tool-call memory](tool-call-memory.md)

## What it does

Every content memory carries a number between 0 and 1 called its strength. Recall uses it to rank: a strong memory scores a little higher than a weak one. The number changes:

* It **fades** with time, with a half-life of 7 days, towards a floor called the baseline.
* It **rises** by 0.15 each time the memory is shown and used, or is confirmed by you.
* It **falls** by 0.15 when it fed an answer you then called wrong.
* The floor **creeps up** slowly for memories that keep proving useful (this is crystallization).
* A memory that is old and weak is moved to cold storage. Nothing is deleted.

## Why it exists

Without this, memory only grows, and old noise ranks the same as proven fixes. Strength lets recall favour what has helped, let unused things fade from the front, and learn from your corrections, with simple arithmetic and no model.

## How it works

1. A new node starts at strength 0.3 with a baseline of 0.
2. Time pulls strength towards the baseline. After 7 days the gap to the baseline is halved; after 14 days, quartered.
3. When a recall shows a memory and your request is saved, the memory is reinforced: its settled strength plus 0.15, up to 1.
4. After 20 reinforcements, the baseline rises by 0.05 (up to 0.6), so a much-used memory never fades fully away.
5. If you correct the answer, or mark it wrong or frustrated, the memories that fed that answer are penalised by 0.15 (not below 0). The baseline never rises on a penalty.
6. Once an hour, nodes older than 14 days with strength below 0.1 are moved to `cold.json.gz`.
7. Cold nodes are still searched, with their score multiplied by 0.9. If one is used, it is moved back to active memory.

### Worked example

A lesson is saved with strength 0.6, baseline 0 (lessons are created stronger; see Details).

| Day | Event | Strength |
|---|---|---|
| 0 | saved | 0.60 |
| 7 | nothing used it (half-life) | 0.30 |
| 7 | recall used it | 0.45 |
| 14 | nothing since (half-life again) | 0.225 |
| 14 | recall used it | 0.375 |

A request node starts at 0.3. If it is never used it falls to 0.15 at day 7, 0.075 at day 14, and drops below the 0.1 cutoff soon after, so the next hourly sweep stores it as cold.

A node reused 20 times gets baseline 0.05. At 40 reuses, 0.10. The baseline caps at 0.6 (after 240 reuses), but in practice each reuse also needs it to be shown again, so a baseline of 0.1 to 0.3 is typical for the best memories.

### What counts as use

* **A recall attached to a request.** The recall is matched to the request by session, within 5 minutes, and the start of the question. The items shown are reinforced and the request is linked to them.
* **A repeated failure.** The same error signature again reinforces the failure node.
* **A mark.** `worked` reinforces the previous request and answer, and the memories that fed that request. `important` and `frustrated` set priority 2 and reinforce.

### What counts as misleading

* A message of yours that reads as a correction penalises the previous answer (once per answer).
* A `wrong_answer` or `frustrated` mark also penalises the memories that were retrieved for the wrong request.

## Limits and settings

| Constant | Value | Meaning |
|---|---|---|
| Reinforce step | 0.15 | Added on use |
| Half-life | 7 days | Fade time (scaled by priority) |
| Crystallize interval | 20 reuses | Baseline step trigger |
| Baseline step | 0.05 | Added each interval |
| Baseline max | 0.6 | Ceiling |
| Creation strength | 0.3 | New nodes |
| Cold after | 14 days (`coldAfterDays`) | Minimum age |
| Cold below | 0.1 (`coldBelow`) | Strength cutoff |
| Sweep | once per hour | `state.lastSweep` |

`coldAfterDays` and `coldBelow` can be changed in `config.json`. The strength constants are fixed in code.

Only content pools fade and go cold: lesson, request, correction, response, thinking, tool_call, failure, success, image. Research and the structure nodes (group, project, session, helper) do not.

Priority stretches the half-life: a node with priority 2 fades half as fast, priority 3 a third as fast.

## How to see it working

* `/recall <words>` shows items; strong ones tend to come first.
* `/recall active` lists active memory; the counts per pool drop as nodes go cold.
* `recalls.jsonl` shows which items were shown, and later which requests they were attached to.
* Check a node in `memory.json`: `strength`, `reuses`, `penalties`, `baseline`, `lastTouched`.
* After an hourly sweep, `cold.json.gz` grows (`zcat cold.json.gz | head`).

## Known limits

* Strength is only touched when a recall is attached to a request that gets saved. A memory used by Claude but never shown by recall is not reinforced.
* A single wrong correction (or a message that only looks like one) can penalise good memories. The penalty is small (0.15) and heals with the next use.
* Penalties are not retroactive for the baseline: a memory that had crystallized keeps its baseline even if it later misleads.
* Memories saved while the mod is off are still indexed later, but never reinforced during that time.
* Cold storage has no automatic deletion, so it grows. It is compressed.
* The numbers are tuned by hand, not learned. They are plain constants you can change in `engine/strength.mjs`.

## Details

### `engine/strength.mjs`

* Constants: `REINFORCE_STEP = 0.15`, `HALF_LIFE = 7 days`, `CRYSTALLIZE_INTERVAL = 20`, `BASELINE_STEP = 0.05`, `BASELINE_MAX = 0.6`, `CREATION_STRENGTH = 0.3`.
* `strengthOf(node, now)` = `baseline + (strength - baseline) * 0.5 ^ (elapsed / (7d * priority))`. Priority defaults to 1.
* `reinforce(node, now)`: `strength = min(1, settled + 0.15)`; `reuses += 1`; `lastTouched = now`. When `reuses % 20 == 0` and `baseline < 0.6`, `baseline += 0.05`.
* `penalize(node, now)`: `strength = max(0, settled - 0.15)`; `penalties += 1`. The baseline is not raised.
* `settled` is `strengthOf` at the moment of the change.

### Where it is called

* `engine/index.mjs`: `attachRecall` (recall to request by session, within 5 minutes, and the head of the question), repeated failure signature, correction penalty (flag `penalized` ensures once per answer), hourly cold sweep.
* `engine/marks-apply.mjs` and `engine/mark.mjs`: marks.
  * `worked`: reinforce previous request and answer, plus the retrieved nodes of the previous request (guarded by `confirmedReinforced`).
  * `important`: priority 2 and reinforce.
  * `frustrated`: priority 2, reinforce the correction, penalise the retrieved nodes of the wrong request.
  * `wrong_answer`: penalise the retrieved nodes.
  * `lesson`: node created with priority 3, strength 0.6 and `lastTouched` set to the mark time.
* `engine/recall.mjs`: uses `strengthOf` in `s = base * (0.8 + 0.4 * strength)`. The factor ranges from 0.8 at strength 0 to 1.2 at strength 1.
* `ensureActive` moves a used cold node back to active memory.

### Cold sweep

Once per hour (`state.lastSweep`): for nodes in the content pools with age over `coldAfterDays` (14) and current strength below `coldBelow` (0.1), move to `cold.json.gz`. Recall searches cold storage only when active gave fewer than `max` results, with a score multiplier of 0.9.

### Forgetting by hand

`correct_memory` (with the 8-character ref from a recall) can replace a lesson's text, forget it (it is listed in `corrections.json` and excluded from recall), or undo that change. It is the way to remove a memory that is wrong; strength alone only demotes.

### Quick reference: reading a node

* `strength`: the stored value at `lastTouched`. The current value is lower if time has passed.
* `baseline`: the floor it fades to; 0 until 20 reuses.
* `reuses` and `penalties`: how often it helped and how often it misled.
* `priority`: 1 normal, 2 for important or frustrated marks, 3 for saved lessons. Higher priority fades slower.
* A node near 0 for 14 days is a candidate for cold storage at the next hourly sweep.

### Why the multiplier is gentle

Strength scales the recall score by 0.8 to 1.2 only. A strong but weakly matching memory therefore cannot beat a weak but exact match by much, so strength breaks ties and nudges order rather than deciding what is found. A memory with strength 0 is still found if it matches well.

### Tuning notes

* A shorter half-life makes memory forget faster and keeps recall focused on recent work.
* A larger reinforce step makes a few uses enough to dominate; the cap at 1 limits the effect.
* Raising `coldBelow` or lowering `coldAfterDays` moves more nodes to cold storage, which shrinks `memory.json` and speeds the active search at the cost of a 0.9 score factor on those items.
* These are source constants in `engine/strength.mjs` (the cold settings are in `config.json`); change them there and rerun the indexer.
* Because strength is stored with `lastTouched`, changing a constant takes effect on the next read without migrating data.

### Related behaviour to know

* Reinforcement happens when the indexer next reads the transcript, not at the moment of the message, so strength lags by up to the 20-second indexing interval.
* The hourly sweep is checked when the indexer runs, so a sweep may be late if no session is open.
* A memory reinforced and penalised in the same run ends near where it started (+0.15 then -0.15).
* Marks are logged in `marks.jsonl` and applied once; rerunning the indexer does not apply them twice.
