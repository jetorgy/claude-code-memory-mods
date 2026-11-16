# Flight recorder

A plain log of what the mods decided and why, one line per decision, with a small viewer to read it.

Related: [../session-memory/off-switch.md](../session-memory/off-switch.md), [../session-memory/active-window-and-compaction.md](../session-memory/active-window-and-compaction.md), [../model-selector/routing.md](../model-selector/routing.md), [../model-selector/gpu-watcher.md](../model-selector/gpu-watcher.md), [../subagent-router/overview.md](../subagent-router/overview.md)

## What it does

The session-memory and model-selector mods make many small decisions that you never see: what was recalled, which model graded a prompt, whether the local model or Haiku answered, when the context was compacted, when the GPU was handed back to a game. The flight recorder writes each of those to a log file as one line of JSON, with a time, the name of the mod and the name of the event. A second script reads the log and prints a summary and the latest events.

It records decisions and numbers (counts, sizes, model names, short reasons). It does not store your prompts, replies or file contents; the largest free-text field is a task label cut by the mod that writes it.

## Why it exists

When something looks wrong ("why did it use Haiku there?", "why did memory switch itself off?", "why was that not recalled?") the mods used to leave no trace. The log answers "why did it do that" after the fact, and it gives real token counts to check claims about what the mods cost or save.

## How it works

### Writing

`extras/flight-recorder/rec.mjs` takes `SOURCE EVENT [JSON]` and appends one line to `log.jsonl` in its own folder:

`{"ts": "<ISO time>", "source": "...", "event": "...", ...fields}`

It is installed to `<claude home>/flight-recorder/`, so on this machine the log is `~/.claude/flight-recorder/log.jsonl`. The file is created with mode 0600 (owner read and write only).

* If the JSON argument is not valid, the line holds `raw` with the first 300 characters of it instead.
* When the file is over 5,000,000 bytes at the next write, it is renamed to `log.old.jsonl` (replacing any earlier old copy) and a fresh file starts. So at most one older file is kept.
* The script never throws and never exits with an error. A recorder must not break a mod.

The mods call it through a small `rec()` helper that starts `node <plugin root>/../../flight-recorder/rec.mjs` in the background with a 3 second limit. It does not wait for the result, and a failed write is ignored. One writer is different: the GPU watcher (`engine/gpuwatch.mjs`) writes its `gpu_yield` line to the log file itself.

### Events

| Source / event | Fields | Written when |
|---|---|---|
| session-memory / switch | state | memory turned off or on |
| session-memory / switch_refused | state and by "mod", or tool and by "model" | the off-switch was triggered by a mod or by the model, and refused |
| session-memory / window | chars | the recent-window text is added to a prompt |
| session-memory / prompt_recall | items, handoff, chars | recall added to a prompt |
| session-memory / held_call | tool | a tool call that had failed before was held once, with a warning |
| session-memory / websearch_nudge | tool, why "repeat-in-session" | Claude was told to search the web after the same tool error happened twice in a session with no fix on record |
| session-memory / tool_note | tool, chars, items, kinds, failed | a note attached to a tool result; kinds is topic, related, error or other |
| session-memory / context | tokens, window, percent | context size measured |
| session-memory / compact_try | where, tokens, result or error | a compaction was tried, from `turn.complete` or `command.run` |
| session-memory / context_error | error | measuring context failed |
| session-memory / compact | trigger, tokensBefore | a compaction happened |
| model-selector / small_call | job, via, ms, why | a small side task ran; via is local, haiku or none |
| model-selector / local_start | result | the local model was started |
| model-selector / grade_failed | mode | grading failed |
| model-selector / grade | mode, need, model, effort, task, why | a prompt was graded |
| model-selector / guidance | need, kind, chars | a guidance note was added; kind is clarify or expert |
| model-selector / turn_done | ms, usage, aborted | a turn finished, with real token usage |
| model-selector / poll | step, from, to, move, failures | the selector re-checked the model; every 4th step |
| model-selector / gpu_yield | freeBesidesOurs, releasedMb, by "watcher" | the GPU watcher released the local model |

The `why` on `small_call` is one of: "off", "gpu busy (N MB free besides ours)", "local did not answer", "local answer unusable". For the routing and GPU events see [../model-selector/routing.md](../model-selector/routing.md) and [../model-selector/gpu-watcher.md](../model-selector/gpu-watcher.md).

Not recorded: research-mode events, auto-saved web results, repeat holds on searches, and anything from the sub-agent router.

### Reading

`view.mjs` reads `log.jsonl` and prints:

1. the event count and the time span;
2. a count per `source/event`, most frequent first;
3. real token usage, summed over every `turn_done` row that has a `usage` field;
4. the injected text: all `chars` fields added up and divided by 4 for a rough token count, and all `items` added up as "recalled items";
5. the last N rows (default 8), each as time, source/event and its fields cut to 160 characters.

Options: `--last N`, `--since 30m` (also `h` for hours and `d` for days, such as `2h` or `1d`), `--source NAME` (exact name, such as `model-selector`). The viewer reads only `log.jsonl`, not the old file.

## Limits and settings

* Rotation size 5,000,000 bytes; one old copy.
* Write timeout 3 seconds, fire and forget.
* View default last 8 rows; row data cut to 160 characters.
* There is no setting to turn the recorder off alone. To stop it, remove or rename the folder, or the mods will keep calling a missing script (which fails silently).
* The 4-characters-per-token figure is an estimate. The `turn_done` usage is the real count.

## How to see it working

* Summary: `node ~/.claude/flight-recorder/view.mjs`
* Last hour of memory decisions: `node ~/.claude/flight-recorder/view.mjs --since 1h --source session-memory`
* "Why did it switch off?": `grep switch_refused ~/.claude/flight-recorder/log.jsonl`
* "Why that model?": `grep '"event":"grade"' ~/.claude/flight-recorder/log.jsonl | tail -3`
* On this machine at the time of writing the log held 1,619 events. The most frequent were `small_call` (406), `poll` (225), `grade` (210), `turn_done` (193) and `context` (175). These will have changed.

## Known limits

* One bad line breaks the viewer. It parses the whole file at once inside a single `try`, so a line that is not valid JSON makes it print "flight recorder: no events yet". That can happen if the file is cut off mid-write. Check with `tail` and `grep -v` the bad line.
* The "injected" figure sums every `chars` and `items` field, not only recall. `window`, `tool_note` and `guidance` events carry `chars` too, so the total counts all of them.
* Two writers can append at once. Each line is a single append, which is normally safe, but the log is not locked.
* The log is not trimmed by age. It only rotates by size, and after two rotations the oldest events are gone.
* The `--since` value must look like `30m`, `2h` or `1d`; anything else is ignored and all rows are shown.
* The log holds task labels and tool names. Keep the folder private (the file mode already limits it to your user).

## Details

* `extras/flight-recorder/rec.mjs`: arguments, rotation, file mode, never throws.
* `extras/flight-recorder/view.mjs`: summary, `--last`, `--since`, `--source`.
* `mods/session-memory/hooks/register.ts` and `mods/model-selector/hooks/register.ts`: the `rec` helper (a background `node` call with a 3 s limit) and every `rec($, '<event>', {...})` call site.
* `mods/model-selector/engine/gpuwatch.mjs`: writes `gpu_yield` itself. It checks every 2 seconds, with a 4,500 MB free-memory threshold.
