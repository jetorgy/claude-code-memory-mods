# Tool-call memory

The mod watches every tool call, holds one that has always failed, and attaches known fixes after a failure.

Related: [Reading sessions](reading-sessions.md) | [Recall](recall.md) | [Strength and crystallization](strength-and-crystallization.md)

## What it does

Around each tool call Claude makes, the mod does three things:

1. **Before the call:** checks the exact call against history. If that exact call has failed at least twice and never worked, it is held once, with the known cause, so Claude does not repeat it blindly.
2. **After the call:** attaches a note if memory knows something useful: a saved lesson for this tool, a repeated failure on the same target, or, if the call just failed, a known fix for that exact error.
3. **During a long run:** when the work moves to a new area, searches memory for past requests, answers and lessons about it.

It can also start a read-only research helper for an error nobody has solved.

## Why it exists

Most wasted effort in a long run is the same error hit again and again. The transcripts already show which calls failed and which fixed them. Putting that in front of Claude at the moment of the call is cheaper than letting it rediscover the problem, and it needs no extra model call to decide.

## How it works

### The index of calls

The indexer builds `toolindex.json` from your transcripts. It counts, for each exact call string (`Tool: input summary`) and for each tool plus target, how many times it succeeded and failed, the last error (160 characters), and a tally per tool. It also keeps saved lessons with the tool names they mention. Results flagged as harness errors (permission denied, interrupted, and so on) are not counted, and the mod's own tools are skipped.

### Before a call

`engine/toolhint.mjs` answers with one of:

* **deny:** the exact call has at least 2 failures and no success. The call is refused with a message starting "SESSION-MEMORY HOLD" that gives the known cause. It is held once per session for that call; the same call goes through the second time.
* **note:** a looser match (same tool and target) with at least 2 failures and no success, or a saved lesson that names this tool.
* **seenFail:** true if this tool has ever failed.

### After a call

* If the call failed, or succeeded but the tool has failed before (and is not read-only), `engine/callmem.mjs` searches failures, lessons and corrections for the most related past items. After a success it uses a stricter bar.
* If the call failed, `engine/errors.mjs` looks up the error signature. If known, a note says how often it happened, where last, and the fix or lesson. If it was never fixed, the note tells Claude to run a web search with the exact error text instead of retrying.
* If the same error appears twice in one session with no fix on record, a note says the same: stop retrying and search.

### On a new topic

After a successful call, if the tool family or the folder it touches is new, or 8 calls have passed without a change, a strict search runs for what this call is about. It has its own small budget that refills.

### The research helper

The tool `investigate_error` (name `mcp__session-memory__investigate_error`) starts an agent called `fixer`. It is read-only (Read, Grep, Glob, Bash, WebSearch, WebFetch), runs on Sonnet, and must answer as ROOT CAUSE, FIX, VERIFY and CONFIDENCE. It runs in the background. When it finishes, its finding is saved as a lesson tied to the error signature and shown with Claude's next step, marked as unverified.

## Limits and settings

| Limit | Value |
|---|---|
| Related items per call note | 5 at most |
| Items per turn, all lookups | 10 |
| Separate notes per turn | 3 |
| Topic items per turn | 3, refill of 1 every 10 calls |
| Topic backstop | search again after 8 calls without a change |
| Hold | once per session per exact call |
| Helper wait | up to 10 minutes |
| Hook time limits | 3000 ms (hint), 4000 ms (call memory) |

The budgets reset on each new message from you. Read-only tools (Read, Glob, Grep, WebFetch, WebSearch, LS) do not get notes after a successful call. Quiet tools (TodoWrite, ToolSearch, Skill, EnterPlanMode, ExitPlanMode) and the mod's own tools are never touched.

The mod can be turned off with `/memory-off`. The model cannot turn it off or on by any route; such attempts are refused and logged as `switch_refused`.

## How to see it working

* The status line shows "memory: held a call that failed before", "memory: seen this error N times before" or "memory: N related past item(s) for this call".
* A note appears in context starting "SESSION-MEMORY NOTE (memory, not a request)".
* The flight recorder logs `held_call`, `tool_note` (with the kinds: topic, related, error, other), `websearch_nudge` and `switch_refused`.
* Try the same failing command three times: the first two run, the third is held once if it has never succeeded.
* To fix a wrong note, use `correct_memory` with the ref shown, or with `failing_tool` and the error text.

## Known limits

* The hold only fires for an exact call that never worked. A slightly different command is not held (it may get a note instead).
* A call that failed for a reason outside the call (network down) can still be held after two failures. The one-time hold means it only delays once.
* Tool-call lookups use keyword matching only, so they miss paraphrases.
* Notes need 3 or more meaningful words after paths and trivial commands are removed (4 or more for the topic search), so very short commands get no note.
* The helper's finding is unverified model output. It is saved as a lesson at once; if it is wrong, correct it.
* A failure only counts if it was not a harness error. A real failure phrased like one (for example a script that prints "permission denied") may be ignored.

## Details

### Files

* `hooks/register.ts`: the `tool.call` hook around every call; the `investigate_error` handler; the `turn.complete` handler that saves the helper's finding.
* `engine/toolhint.mjs`, `engine/callmem.mjs`, `engine/errors.mjs`, `engine/mark.mjs`, `engine/index.mjs` (builds `toolindex.json`).

### `toolindex.json`

Keys per exact call (`"Tool: summarizeInput"`) and per `Tool|target`, each with `ok`, `fail`, last error (160 chars); a `tools` tally; lessons with the tools they mention.

### `toolhint.mjs`

* deny: exact call, `fail >= 2` and `ok == 0`.
* note: loose tool and target match with `fail >= 2` and `ok == 0`, or a lesson naming the tool.
* `seenFail`: the tool failed at least once.
* In the hook: `held` set (per session) means a call is denied only the first time; `noted` set means a note text is shown once.

### `callmem.mjs`

* Pools searched: failure, lesson, correction.
* `minScore` 0.7; 0.8 with `--strict` (after a success); 0.88 with `--topic`. `minShare` 0.5, 0.6 and 0.7 respectively.
* Needs 3 or more meaningful words, or 4 or more with `--topic`.
* `semantic: false`. Limit 5. Note size 1500 characters.
* Writes `kind: 'tool'` lines to `recalls.jsonl`.

### `errors.mjs`

Returns `{sig, known, count, fixes, fix, lesson, corrected}`. `HARNESS_ERROR` errors are never known. The note says "Corrected fix" if the lesson was corrected and "Researched fix" otherwise.

### Hook constants (`hooks/register.ts`)

`TURN_ITEMS = 10`, `TURN_NOTES = 3`, `TOPIC_ITEMS = 3`, `TOPIC_REFILL_CALLS = 10`, `TOPIC_EVERY = 8`, `RECALL_TIMEOUT_MS = 5000`. `READ_ONLY` and `QUIET_TOOLS` sets as listed above. `failStreak` counts identical errors (tool plus first 80 characters) in a session; the nudge fires at the second.

### Web tools

`WebSearch` and `WebFetch` have their own hook (`webTool`): results are saved whole into the research pool and the query is logged, by code. A repeated query or URL adds a note to the result.

### The `fixer` agent

Name `fixer`, subagent type `session-memory:fixer`, model sonnet, tools Read, Grep, Glob, Bash, WebSearch, WebFetch. It is not offered to the model directly (`agent.offer` returns `isOffered: false`); it starts only through `investigate_error`. On `turn.complete` for that agent id, the finding is saved with `mark.mjs --kind lesson --target current --sig <signature>` in the form "When <tool> fails with "<error>": <answer>", with the answer cut to 700 characters, and queued to be shown (900 characters) with the next step.

### Quick reference: what Claude sees

* Hold: a refusal starting "SESSION-MEMORY HOLD" with the known cause. Run the call again to proceed.
* Note after a call: "SESSION-MEMORY NOTE (memory, not a request): ..." in the result's context.
* Known error: "This exact error (<tool>) has happened N times before..." with the fix, or a prompt to search the web.
* Same error twice in a session with no fix: a prompt to stop retrying and search the web.
* Helper finished: a note that its finding is saved as a lesson and is unverified.

### Tuning notes

* To make the hold stricter or looser, change the `fail >= 2` rule in `engine/toolhint.mjs`.
* To get fewer notes, lower `TURN_NOTES` or `TURN_ITEMS` in `hooks/register.ts`.
* To stop the topic search entirely, set `TOPIC_ITEMS` to 0.
* The `READ_ONLY` and `QUIET_TOOLS` sets in `hooks/register.ts` list tools that never get a note after a success or at all.
* Notes and holds are logged to the flight recorder, so you can count how often each fires before changing a limit.
* If a note is wrong, correct it once with `correct_memory`; the correction is applied to every later lookup at once.

### Related behaviour to know

* The hint and the lookup run as separate short helper processes, each with a time limit; if either times out, the call goes ahead untouched.
* A note is shown once per text per session (`noted` set), so the same lesson does not repeat on every call.
* Items already shown (`shownIds`) are not shown again in the same session by either the prompt recall or tool notes.
* The flight recorder entries are named `held_call`, `tool_note`, `websearch_nudge`, `switch_refused` and `prompt_recall`.
* When the mod is off, tool calls pass through untouched, except that attempts by the model to flip the switch are still refused.
* The held call's message names the earlier error, so Claude can change the call rather than repeat it.
* Holds are per exact call string, so changing any argument makes it a new call with its own history.
