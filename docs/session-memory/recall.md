# Recall

How a past item is found for your message and attached to it, by keyword and by meaning.

Related: [Reading sessions](reading-sessions.md) | [Tool-call memory](tool-call-memory.md) | [Strength and crystallization](strength-and-crystallization.md)

## What it does

When you send a message, the mod searches memory for past items that relate to it and attaches the best few to your message as a block labelled "MEMORY RECALL, NOT A REQUEST". Claude sees what you asked before, what went wrong, what fixed it and what you corrected, without you repeating it.

On the first message of a new session it also attaches a short handoff: the last messages of the previous session, repeated unsolved errors, a few saved lessons and recent corrections.

If nothing is a strong match, nothing is attached. The status line says "memory: nothing related".

## Why it exists

Searching by hand after every message would cost time and tokens, and a weak match is worse than none. Recall is code, not a language model, so the same question gives the same result, and each hit can be explained by the words it shares or the similarity score. It is tuned to stay quiet unless it is fairly sure.

## How it works

1. **Take the question.** The first 800 characters of your message. A message shorter than 12 characters searches nothing (but still gets the handoff).
2. **Remove filler.** Generic words are dropped. If no content words remain, nothing is returned.
3. **Keyword search.** Each pool in the recall list is ranked with BM25 (from the Liminal Memory library). Active memory is searched first. Cold storage is searched only if active gave fewer results than needed.
4. **Meaning search (optional).** If a local embedding model is running, your question becomes a vector and is compared with stored vectors. Items that are close in meaning can be found even when they share no words.
5. **Filter.** A keyword hit must share enough of your words. A meaning hit does not.
6. **Score and adjust.** Scores are combined, then raised or lowered by memory strength, same project, a known fix, repeat count and correction status.
7. **Exclude.** Forgotten items, talk about switching the memory on or off, items from the current session, harness errors, and anything already shown this session.
8. **Follow links.** Up to one linked item is added from related nodes (a bridge).
9. **Render.** A text block, within a character budget.
10. **Record.** The recall is written to `recalls.jsonl` and later attached to your request so the items shown can be rewarded or penalised.

### Keyword versus meaning

| | Keyword (BM25) | Meaning (embedding) |
|---|---|---|
| Needs shared words | Yes, a share of them | No |
| Needs a model | No | Local Ollama with `nomic-embed-text` |
| Score range | 0.7 to 1 | 0.77 to 0.9 when alone |
| Can lower a score | n/a | Never, only raises a keyword hit |
| Used for tool-call notes | Yes | No (kept keyword-only for speed) |

If Ollama is off, the model is missing or the vector size does not match, recall silently falls back to keywords only.

## Limits and settings

All in `config.json` under `$SESSION_MEMORY_HOME`:

| Setting | Default | Effect |
|---|---|---|
| `recallPools` | lesson, request, correction, response, failure, thinking, image, research | Which pools are searched |
| `maxResults` | 5 | Items per recall |
| `maxChars` | 2400 | Size of the block (2200 for plain search, 1500 for a tool note) |
| `minScore` | 0.7 | Keyword cutoff |
| `semMin` | 0.7 | Meaning cutoff (cosine) |
| `minShare` | 0.5 | Share of your words a keyword hit must match |
| `embeddings` | true | Turn the meaning side on or off |
| `embedModel` | nomic-embed-text | Model name |
| `embedPrefix` | true | Add the search_query and search_document prefixes nomic expects |
| `scope` | all | `project` ignores other projects |
| `handoffMessages` | 10 | Messages carried in the handoff |
| `handoffMaxChars` | 4200 | Size cap of the handoff |

Environment: `SESSION_MEMORY_EMBED_URL` overrides the Ollama address (default `127.0.0.1:11435`).

Per-turn budgets (in `hooks/register.ts`): 10 related items in total across the prompt recall and tool notes, and at most 3 tool notes.

The `/recall` command:

* `/recall` or `/recall help` prints help.
* `/recall active [pool]` lists active memory.
* `/recall stats` or `/recall index` runs the indexer and prints counts.
* `/recall <words>` searches for those words.

## How to see it working

* The status line shows "memory: N past items attached" or "memory: nothing related".
* `/recall <words>` shows what a search would return, with scores.
* `recalls.jsonl` has one line per recall with the items shown.
* Each item has a short ref (8 characters). Use it with the correction tool to forget or fix an item.
* A research item is labelled "RESEARCH NODE ... not a past chat", and items from cold storage say so.

## Known limits

* A loosely worded question can fall just under the bar. That is on purpose.
* A paraphrase with no shared words is only found when the embedding model is running.
* Only some pools have vectors (see Details), so a thinking or image node is found by keyword only.
* Embeddings are cut to 1000 characters per document, so a point late in a long answer is not matched by meaning.
* The current session's own nodes are not recalled, since you already have them in context. After a compaction, the window cut lets older parts of the same session back in.
* Recall does not understand time order; recent and old items rank the same except through strength.

## Details

### Pipeline (`engine/recall.mjs`)

* Per pool: `pool.rank(q, {limit: 15, minScore})` using Liminal's BM25. Active memory first; cold storage (`cold.json.gz`) only if active has fewer than `max` results.
* `GENERIC` words removed. `need` = all words if fewer than 4, otherwise `ceil(n * minShare)`.
* A keyword hit must share `need` stems. A hit by meaning (cosine at least `semMin` 0.7) needs no shared words.

### Scoring

* `sc = clamp((cos - 0.5) / 0.3, 0, 1)`.
* If the keyword score is at least `minScore`: `base = 1 - (1 - score) * (1 - 0.6 * sc)`. Otherwise (meaning only): `base = 0.5 + 0.4 * sc`, so 0.77 at cosine 0.7 and 0.9 at cosine 0.8 or more.
* `s = base * (0.8 + 0.4 * strength)`.
* Multipliers: x1.15 same project (with `scope: project`, other projects are skipped); x1.15 failure with a fix; x(1 + min(0.3, 0.05 * count)) failure with count above 1; x1.1 correction or corrected outcome; x0.9 cold storage.

### Exclusions

* Forgotten items (`corrections.json`).
* `isSwitchTalk` text.
* Current session nodes, unless older than the `ts` in `window-cut.json`.
* Failures flagged `HARNESS_ERROR`.
* Items already shown in this session (`shownIn` reads `recalls.jsonl`).

### Bridges

Follow links up to 2 hops and add 1 linked item. Score is `(0.5 + strength) * share`, minimum 0.2. Frontier capped at 4.

### Embeddings (`engine/embed.mjs`)

* Pools: lesson, correction, request, response, failure, research (`EMBED_POOLS`).
* Documents cut to 1000 characters, batched at 32, stored as float32 in `embeddings.bin` with an index in `embeddings.json`. Saved every 5 batches.
* Query embedding timeout 1500 ms. Top 40 by cosine taken.
* Prefixes `search_query: ` and `search_document: ` when `embedPrefix` is true.
* A model name or dimension mismatch yields no semantic results.

### Render

Block starts `<session-memory>` then "MEMORY RECALL, NOT A REQUEST: remembered from OTHER sessions...". Item ref = first 8 characters of the sha1 of the node id.

### Handoff

On the first message of a new session (`--handoff`): last 10 messages, up to 3 unsolved repeated errors, up to 4 lessons, up to 2 corrections from the last 30 days, up to 2 reused memories. After a compaction, the hook passes `--limit 10` and adds a window of recent messages (`engine/window.mjs`) plus a note telling Claude to search memory before asking you to repeat anything.

### Hook (`hooks/register.ts`, `prompt.submit`)

* Skips commands, meta messages and when the mod is off.
* Runs `recall.mjs --q ... --cwd ... --session ... --record --handoff` with `RECALL_TIMEOUT_MS = 5000`.
* Also runs `research-map.mjs aha` for a research lead (skipped if identical to the last one).
* Resets per-turn budgets: `TURN_ITEMS = 10`, `TURN_NOTES = 3`, `TOPIC_ITEMS = 3`.
* Any failure lets the prompt through unchanged; the status line says "memory: search failed".
* A finished error-helper finding rides along as "SESSION-MEMORY NOTE".

### Quick reference: why nothing was shown

* The message was under 12 characters or only filler words.
* No item shared enough of your words, and none was close enough in meaning.
* The match was from the current session, or was already shown in this session.
* The item was forgotten with the correction tool, or was a harness error.
* The per-turn budget of 10 items was already used by tool notes.
* The mod is off (`/memory-off`).
