# Why recall is limited to these numbers

One line: automatic recall shows few, high-scoring memories (about 5 per lookup, 10 per message, 3 notes) so it helps without flooding the conversation.

Related: [../session-memory/recall.md](../session-memory/recall.md), [../session-memory/strength-and-forgetting.md](../session-memory/strength-and-crystallization.md), [../reference/configuration.md](../reference/configuration.md), [strength-constants.md](strength-constants.md)

## The choice (from `store.mjs`, `register.ts` and `recall.mjs`)

Config defaults:
- `maxResults` 5, `maxChars` 2400.
- `minScore` 0.7 (keyword side), `semMin` 0.7 (cosine, embedding side), `minShare` 0.5.
- `embeddings` true, `embedModel` nomic-embed-text.

Per-message limits:
- `TURN_ITEMS` 10 memories and `TURN_NOTES` 3 notes in total per message.
- The search tool returns `min(5, limit)` per call.
- After a compaction, recall runs with `--limit 10`.
- Tool-note recall (notes attached when a tool is used) takes `min(5, itemsLeft)`.
- Topic lookups: `TOPIC_ITEMS` 3, refilled 1 per 10 calls (`TOPIC_REFILL_CALLS`), checked every 8th (`TOPIC_EVERY`).
- A memory already shown this session is never shown twice.

## The problem it solves

Every memory shown costs tokens on every later turn and competes for Claude's attention. Too many, or loosely related ones, make answers worse and bills bigger. Recall exists to bring the one relevant thing back, not to dump history.

## How a score is made

Two searches run in parallel (limit 15 each): a keyword search (Liminal's BM25-like rank) and a meaning search using local embeddings. They are blended:

`base = score >= min ? 1 - (1 - score) * (1 - 0.6 * sc) : 0.5 + 0.4 * sc`, where `sc = (cosine - 0.5) / 0.3`, clamped to 0..1.

In words: if the keyword score clears the bar, agreement from the meaning search raises it; if not, meaning alone can still place it between 0.5 and 0.9. Then multipliers apply:
- strength: x(0.8 + 0.4 * strength)
- same project: x1.15
- a failure that was later fixed: x1.15
- a repeated failure: up to x1.3
- a user correction: x1.1
- cold tier: x0.9

## Why the cosine floor is 0.7

The code comment says unrelated text under the nomic model tops out near 0.65 cosine. 0.7 is placed just above that noise ceiling. This is from the code comment, not a measurement in the repo's tests that I could find.

## Why these small caps

Evidence level: the values are from the code; the reasons are mostly inference, not verified.

- The per-message cap (10) and note cap (3) look chosen to keep the injected text to a few paragraphs. No history entry explains 10 versus 8 or 15.
- `TOPIC_ITEMS` 3 with a slow refill (1 per 10 calls) is a rate limit: a long agent loop with many tool calls should not get a topic block every call. The code comment describes it as a budget; why exactly 3, 10 and 8 is not recorded.
- Recall after compaction uses 10 because the conversation was just shortened and the owner wanted continuity, but that wider limit is inference. The window and recall work together: see [active-window-sizes.md](active-window-sizes.md).
- `maxChars` 2400 caps total injected text regardless of count.

## Why "none twice"

If a memory is already in view (shown earlier this session and still in the live conversation), showing it again wastes tokens. After a compaction the older shown items are no longer in view, which is why the mod records where the window was cut (`window-cut.json`) and lets earlier memories be recalled again.

## Why embeddings are local

Meaning search needs vectors. They come from `nomic-embed-text` on the private local Ollama, so no text leaves the machine. See [private-local-ollama.md](private-local-ollama.md). If Ollama is unavailable, recall degrades to keyword-only; it does not fail.

## Alternatives and trade-offs

- Higher caps: more chance of finding the right memory, more noise and cost.
- Lower caps: cleaner, but misses.
- Higher `minScore`/`semMin`: fewer false recalls, more missed ones.
- Always search with an LLM re-ranker: better precision, but slower and costs model calls. Not used.
- No automatic recall (only the search tool): cheapest, but Claude must know to look; the owner wanted it to recall by itself.

## How to change it

- `maxResults`, `maxChars`, `minScore`, `semMin`, `minShare`, `embeddings`, `embedModel`: the config file; see [../reference/configuration.md](../reference/configuration.md).
- `TURN_ITEMS`, `TURN_NOTES`, `TOPIC_*`: constants in `hooks/register.ts`; `/reload-plugins` after editing.
- Raise the floors first if recall feels noisy; lower them if it misses things you know are stored.
