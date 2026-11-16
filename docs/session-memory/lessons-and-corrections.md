# Lessons and corrections

Claude and you can mark answers as wrong, confirmed or important, save lessons, and fix or forget a single memory on the spot, without ever deleting anything.

Related: [reading-sessions.md](reading-sessions.md), [recall.md](recall.md), [tool-call-memory.md](tool-call-memory.md), [strength-and-crystallization.md](strength-and-crystallization.md), [../research/research-pool.md](../research/research-pool.md), [../reference/configuration.md](../reference/configuration.md), [../reference/files-on-disk.md](../reference/files-on-disk.md), [../extras/flight-recorder.md](../extras/flight-recorder.md)

## What it does

Two tools let the memory learn from feedback.

- `mark` records a judgement about an exchange: `wrong_answer`, `frustrated`, `worked`, `lesson` or `important`.
- `correct_memory` repairs one remembered item: replace its text with a corrected one (`fix`), hide it (`forget`), or restore the original (`undo`).

Marks change how strongly a memory is trusted. Corrections change what a memory says, or whether it is shown at all.

## Why it exists

Memory that cannot be corrected goes bad. A fix that worked once may be wrong now. An old note may name a path that moved. If the only option were "delete", you would lose the history and Claude would have no way to repair a bad item in the middle of a session.

So the mod never deletes. It keeps the original and adds an overlay: "show this text instead" or "do not show this". Marks do the same for trust: a wrong answer weakens the memories that fed it, a confirmed one strengthens them.

## How it works

### Marks

Claude (or a hook) calls `mark` with a kind, an optional note and a target (`previous`, the default, or `current`). The call appends one line to `marks.jsonl` and returns at once. The indexer applies the mark later, when the exchange has been saved. A mark waits up to 10 minutes for that; after that it is skipped.

| Kind | Effect |
|---|---|
| `wrong_answer` | Your request becomes a correction node linked to the previous answer. Outcome is `corrected`. The memories that were shown for that answer are weakened (once per exchange). |
| `frustrated` | Same as `wrong_answer`, plus a `frustrated` flag, higher priority (2) and a reinforcement, so it is remembered longer. |
| `worked` | The previous request and answer become `confirmed` and are strengthened, and so are the memories that were shown (once). |
| `important` | Priority 2, so it fades half as fast. Optional note. |
| `lesson` | Needs a note. Creates a lesson node, priority 3, starting strength 0.6, linked to the exchange and the session. If the note matches a known failure, it is attached to that failure. |

Write a lesson note as "When X, do Y". Notes are cut at 1,000 characters.

A lesson found by `investigate_error` is written automatically on the next finished turn, in the form "When <tool> fails with ...: <answer>" (see [search-tools-and-commands.md](search-tools-and-commands.md)).

### Corrections

`correct_memory` points at one item in one of two ways:

- `ref`: the 8 hex characters shown next to the item, as `(ref xxxxxxxx)`. A leading "ref " is stripped.
- `failing_tool` plus `error`: the error text is scrubbed and turned into the same signature the failure was saved under.

Then one action:

- `fix`: the corrected text, up to 700 characters.
- `forget`: never show it again.
- `undo`: restore the original.

`fix` and `forget` together are refused. The search covers active memory and cold storage, in the pools lesson, failure, correction, request, response, image and thinking.

The result is a line such as `Corrected (...)`, `Forgotten` or `Correction undone`. Where the item is a lesson, the tool hint index is updated at once, so the fixed text reaches the next tool call without waiting for a re-index; forgetting removes the hint.

## Limits and settings

| Item | Value |
|---|---|
| Mark note | 1,000 characters |
| Correction fix text | 700 characters |
| Wait for a mark to find its turn | 10 minutes |
| Reinforcement step | 0.15 |
| Lesson starting strength / priority | 0.6 / 3 |
| `important` / `frustrated` priority | 2 |
| Half-life of a memory | 7 days, multiplied by priority |

Details of strength are in [strength-and-crystallization.md](strength-and-crystallization.md). All of this is off while the mod is off (see [off-switch.md](off-switch.md)).

## How to see it working

Corrections overlay file:

```
$ python3 -c "import json,os; c=json.load(open(os.path.expanduser('~/.claude/session-memory/corrections.json'))); print(len(c)); [print(k, v['fix'][:60]) for k,v in c.items()]"
2
tr:toolu_01Sg... Write only overwrites a file already Read in this session: Read it first (a file
a:2dffe1fc-ac44-... To start Blender: it is installed through Steam on the external drive. Run `cd /m
```

Each entry has `fix` or `forget`, `ts`, `session` and optionally `why`.

Marks file: `tail -n 3 ~/.claude/session-memory/marks.jsonl`. Each line is `{session, ts, kind, note, target, sig?}`.

In a recall block, a corrected item says `Lesson (corrected):` or `Corrected fix (set by Claude, replaces the earlier one):`. A forgotten item is simply absent. `/recall` and `search` also show corrected text.

## Known limits

- A mark that arrives before its turn is saved is delayed; if the turn never saves, the mark is dropped after 10 minutes.
- `wrong_answer` penalises the memories that were shown, even if the memory was not the cause of the error. The penalty is small and fades.
- The error signature must match exactly after scrubbing (paths, numbers and ids are normalised). A very different wording of the same error will not be found; use the `ref` instead.
- A correction applies to one node. If the same fact lives in several nodes, each needs its own correction.
- Corrections are read once per process, so a long-running helper process may show the old text until it restarts.
- `forget` hides an item from recall and handoff; it still exists on disk and still counts in `/recall stats`.

## Details

- `engine/mark.mjs`: validates `KINDS` (`wrong_answer`, `frustrated`, `worked`, `lesson`, `important`), requires a note for a lesson, appends `{session, ts, kind, note (<=1000), target, sig?}` to `marks.jsonl`.
- `engine/marks-apply.mjs`: run by the indexer. Tracks progress in `state.marksDone`. Handles each kind as in the table above; `wrong_answer`/`frustrated` set the request node's `outcome` to `corrected` and `explicitWrong`, mark `prevReq` corrected, and penalise `retrieved` nodes once per exchange. A `lesson` creates `l:<session>:<ts>`; with a `sig`, it sets `failure.metadata.lesson`.
- `engine/correct.mjs`: parses `--ref` or `--tool` + `--error` (uses `signatureOf(tool, scrub(error))` and `state.sigs`), `--fix`, `--forget`, `--undo`; writes `corrections.json` `{nodeId: {fix|forget, ts, session, why?}}`; patches `toolindex.json` for lesson nodes.
- `engine/recall.mjs`: `forgotten(id)` and `fixedText(id)` (lines 29 to 34) read the overlay once per process; used in `failureLines`, lesson rendering and the handoff.
- `engine/store.mjs`: `refOf` (sha1, 8 hex), `signatureOf`, `scrub`.
- `engine/strength.mjs`: `REINFORCE_STEP` 0.15, `HALF_LIFE` 7 days.
- `hooks/register.ts`: registers `mark` and `correct_memory`; strips a leading "ref " from `ref`; writes the auto lesson from `investigate_error` on `turn.complete`.
- Files: `marks.jsonl`, `corrections.json`, `toolindex.json`, `state.json` (see [../reference/files-on-disk.md](../reference/files-on-disk.md)).
