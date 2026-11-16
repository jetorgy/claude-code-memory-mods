# Active window and compaction

The mod keeps a sliding window of recent exchanges, compacts the conversation itself when it grows past 150,000 tokens, and replays the window in full on the first prompt after a compaction.

Related: [reading-sessions.md](reading-sessions.md), [recall.md](recall.md), [tool-call-memory.md](tool-call-memory.md), [strength-and-crystallization.md](strength-and-crystallization.md), [../research/research-pool.md](../research/research-pool.md), [../reference/configuration.md](../reference/configuration.md), [../reference/files-on-disk.md](../reference/files-on-disk.md), [../extras/flight-recorder.md](../extras/flight-recorder.md)

## What it does

Two things that belong together.

1. It compacts the conversation for you. When the context passes 150,000 tokens, the mod asks Claude Code to compact between turns, so you do not hit the hard limit in the middle of a task.
2. It remembers what you were doing. After a compaction, the first prompt you send gets the last N exchanges (your message and Claude's reply, in full) put back in front of Claude, so the thread of the work does not break.

N is not fixed. It starts at 20 and adjusts itself between 6 and 40 depending on how often compactions happen.

## Why it exists

A compaction replaces the conversation with a summary. Summaries lose detail: the exact wording of the last request, the file Claude was in the middle of editing, the thing you just corrected. The summary is good at the big picture and poor at "what did I just ask".

The window fixes that by pulling the most recent exchanges back from the mod's own saved memory, word for word. Whole exchanges are used, never clipped halves, so a request is never shown without its answer.

Compacting automatically (instead of waiting for the limit) also means the mod chooses when it happens: between turns, never in the middle of one.

## How it works

Plain version:

- After every finished turn of the main agent, a counter goes up by one.
- After each turn, the mod checks how many tokens the session uses. Past 150,000, and at least 5 minutes since the last try, it compacts.
- It asks Claude Code to compact and passes its own instructions, which tell the summary to stay under about 400 words (2,500 characters) and to keep the current goal, open errors and decisions.
- Once per compaction it looks at how many turns passed since the previous one and adjusts the window size (see below).
- On the first prompt after the compaction, it builds the window from saved memory and adds it to the prompt context, under the header `Last N exchanges before the compaction, in full (window size X, tunes itself)`.
- Later prompts do not get the window again. It is shown once.

Tuning, in words: if compactions are coming faster than usual, each exchange is probably long, so the window shrinks by 2 pairs to stay small. If they are coming slower than usual, the window grows by 1 pair. It never leaves 6 to 40.

Size cap: the window text is limited to 40,000 characters (about 10,000 tokens). When it would be longer, the oldest whole pairs are dropped until it fits.

Skipped exchanges: pairs that are only about turning the memory on or off are left out, so the window is not filled with switch-talk (see [off-switch.md](off-switch.md)).

## Limits and settings

| Setting | Value | Where |
|---|---|---|
| Compaction threshold | 150,000 tokens | `COMPACT_AT`, hooks/register.ts |
| Cooldown between compaction tries | 5 minutes | `COMPACT_COOLDOWN_MS`, hooks/register.ts |
| Window start size | 20 pairs | `START_PAIRS`, engine/window.mjs |
| Window minimum / maximum | 6 / 40 pairs | `MIN`, `MAX`, engine/window.mjs |
| Window text budget | 40,000 characters | `BUDGET_CHARS`, engine/window.mjs |
| Intervals remembered | last 8, tuning uses last 3 | engine/window.mjs |
| Summary instructions | 400 words / 2,500 chars | `COMPACT_INSTRUCTIONS`, hooks/register.ts |
| Hook timeout for the session.compact step | 8 seconds | hooks/register.ts |

Recall on the compaction prompt uses `--limit 10` instead of the usual 5, so memory brings back more than usual while the context is fresh.

Compaction and the window are both stopped by `/memory-off`.

## How to see it working

The window's own state is a small file:

```
$ cat ~/.claude/session-memory/window-state.json
{"pairs":15,"turnsSince":18,"intervals":[1,4,1,5,6,7,2,2]}
```

- `pairs` is the current window size.
- `turnsSince` is how many turns have finished since the last compaction.
- `intervals` is the turn count of the last 8 compactions, oldest first.

The cut point, used by recall, is in `window-cut.json`: the session id and the timestamp of the first pair kept.

The flight recorder logs each step (see [../extras/flight-recorder.md](../extras/flight-recorder.md)):

```
{"source":"session-memory","event":"context","tokens":86897,"window":1000000,"percent":9}
{"source":"session-memory","event":"compact","trigger":"auto","tokensBefore":86897}
```

Event names: `context` (token check), `compact_try` (asking for a compaction), `compact` (it happened), `window` (the window was built), `context_error` (the token count could not be read).

You can also run the compaction yourself with `/compact`; the window is shown on the next prompt either way.

## Known limits

- The token count comes from Claude Code. If it cannot be read, no automatic compaction happens that turn (`context_error` is logged).
- Sub-agents never trigger a compaction, and neither does an aborted turn.
- Intervals are counted in turns, not in tokens, so a run of very short turns can push the window up even if the context is small.
- The window can only show exchanges the mod has already saved. Very recent exchanges that were not indexed yet are read first from the session file, but if another reader holds the lock that step is skipped.
- A window with 40 pairs may still be cut by the 40,000 character budget. The oldest pairs go first.
- In Claude Desktop and the SDK the first compaction call is refused; the mod falls back to running the `compact` command. If that fails too, the failure is logged and the next turn tries again after the cooldown.

## Details

Engine files are under `mods/session-memory/engine/`.

- `window.mjs`
  - `--count` increments `turnsSince`. Called from `turn.complete` in hooks/register.ts for each non-aborted main-agent turn.
  - `--session ID` (once per compaction) records `turnsSince` into `intervals` (keeps 8), computes `avg` over the last 3, applies `interval < avg*0.75` then `pairs-2`, `interval > avg*1.33` then `pairs+1`, clamps to `MIN`/`MAX`, and resets `turnsSince`.
  - Builds pairs from this session's request nodes, newest first, up to `s.pairs`, skipping `isSwitchTalk` text. Each pair is the request plus its answer. Drops oldest whole pairs until under `BUDGET_CHARS`.
  - Writes `window-cut.json` `{session, ts}` with the timestamp of the first pair kept.
- `recall.mjs` `searchTier`: reads `window-cut.json`. Memories of the current session older than the cut are allowed back into recall; otherwise the current session's memories are skipped (they are already in the conversation).
- `hooks/register.ts`
  - `COMPACT_AT`, `COMPACT_COOLDOWN_MS`, `lastCompactAt`: the check in the `turn.complete` handler (around line 665). Condition: `e.agentId === undefined && e.isAborted !== true && Date.now() - lastCompactAt > COMPACT_COOLDOWN_MS`.
  - Token source: `$.session.usage()`.
  - Compaction call: `$.session.compact({instructions})`; on error, `$.command.run({command:'compact'})`.
  - `session.compact` hook: runs `index.mjs` first (8 second timeout), sets the instructions to `COMPACT_INSTRUCTIONS`, and sets `compactNote`.
  - `justCompacted` flag: set by the `session.compact` hook or `markCompacted`. The next prompt reads it, runs `window.mjs`, and uses `recall.mjs --limit 10`. The flag is then cleared.
  - Flight-recorder events: `context`, `compact_try`, `compact`, `window`, `context_error`.
- `store.mjs` `isSwitchTalk`: the filter for window pairs.
- State files: `window-state.json`, `window-cut.json` (see [../reference/files-on-disk.md](../reference/files-on-disk.md)).
