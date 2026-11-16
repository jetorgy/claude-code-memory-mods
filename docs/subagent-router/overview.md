# Sub-agent router

Keeps the helper agents Claude starts on cheap models, caps how many run at once, and reminds Claude to split independent work.

Related: [model-selector/routing.md](../model-selector/routing.md), [HOW-IT-WORKS.md](../reference/architecture.md), [WHY.md](../why/index.md), [install/installer.md](../install/installer.md), [extras/flight-recorder.md](../extras/flight-recorder.md)

## What it does

Claude can start helper agents (sub-agents) to do parts of a job at the same time. This mod does three things about them:

1. It picks the model each helper runs on. Helpers run on Haiku (the smallest and cheapest) for lookups, or Sonnet for well-defined work. The mod never picks Opus. Your main chat stays on whatever model you chose.
2. It allows at most 4 helpers to run at once. A fifth is refused with the message "sub-agent limit reached (4 running). Wait for one to finish, or do this step yourself."
3. It adds a short standing paragraph to Claude's instructions that says when to split work into helpers and how to brief them.

Each time it routes a helper you see a small toast: `sub-agent <type> → <model> (<reason>)`.

## Why it exists

Without it, a helper inherits the main model. If the main chat is on an expensive model, a helper that only searches files costs the same per token as the thinking that needed the big model. Many helpers started together multiplies this. The router makes the cheap choice by default, and the cap keeps a burst of helpers from running away. The standing paragraph exists because helpers are only worth it when the work really splits, and Claude does better with a plain rule than with guesswork.

## How it works

### Choosing the model

On each helper start (the `agent.spawn` event), in order:

1. If 4 or more helpers are already running, the start is denied.
2. If the caller asked for a specific model, it is kept, unless the model is `inherit` or contains "opus" (any case). Those are replaced, so a request for Opus does not get Opus here.
3. Otherwise, if the helper type is `Explore` or `claude-code-guide`, it goes to Haiku, with the reason "<type> is a read-only lookup".
4. Otherwise a short grading call is made to Haiku at low effort, with at most 120 output tokens and a 6 second wait. It sees the agent type, the helper's description and its brief (the brief is cut to 6000 characters, with a note that more followed). It answers with a single JSON object, `{"model": "haiku" or "sonnet", "why": "..."}`. The rubric tells it: Haiku for a simple, read-only lookup that is easy to check (find, search, read and summarise, list, gather); Sonnet for anything else, meaning a well-defined change or a job whose "done" can be said in one sentence. It is told to judge the task, never the length of the brief. The text of the task is marked as data to grade, not instructions.
5. If the grading call fails, times out, or gives an answer that is not valid (including "opus" or any other name), the model is Sonnet with the reason "could not grade; Sonnet default".

The reason shown is cut to 100 characters.

### Counting

The count goes up by one after a helper starts successfully, and down by one when a turn completes that belongs to a helper (an event with an agent id). A helper that is denied does not count.

### The standing paragraph

On every prompt composition, a fixed section called `subagent-router:split` with session scope is added. The text is constant on purpose, so it does not change the prompt cache between turns. It says: when there are two or more independent pieces, do them in parallel with the Agent tool, one helper per piece, at most 4 at once; give each helper a full, self-contained brief (goal, exact files or places, what to report back); keep judgment, dependent steps and the final answer for yourself; one piece or tightly linked steps need no helpers; never start more than 4.

### Decision table

| Situation on helper start | Result |
|---|---|
| 4 or more already running | Denied, limit message |
| Caller asked for `haiku` or `sonnet` | Kept, reason "caller chose" |
| Caller asked for `inherit` or an Opus model | Replaced by the steps below |
| Type is `Explore` or `claude-code-guide` | Haiku, no grading call |
| Any other type, grader answers `haiku` | Haiku, reason from the grader |
| Any other type, grader answers `sonnet` | Sonnet, reason from the grader |
| Grader fails, times out, or answers anything else | Sonnet, "could not grade; Sonnet default" |

In every allowed case the toast is shown and the helper is started with the chosen model.

## Limits and settings

* Maximum running helpers: 4 (`MAX_RUNNING`).
* Models it can pick: `haiku`, `sonnet`. A model named by the caller, other than Opus or `inherit`, is passed through as given.
* Grader: Haiku, low effort, 120 tokens, 6000 ms, brief limit 6000 characters.
* To change any of this, edit `mods/subagent-router/hooks/register.ts`: `MAX_RUNNING`, `RUBRIC` (the grading rules), `byType` (types that skip grading) or `NUDGE` (the standing paragraph). There is no settings file or preference. After editing, validate the mod and reload (see [install/installer.md](../install/installer.md)).

## How to see it working

* Ask Claude for a job with two independent lookups, for example "in parallel, find where X is defined and where Y is defined". Watch for one toast per helper, such as `sub-agent Explore → haiku (Explore is a read-only lookup)`.
* To see the cap, ask for five or more helpers at once. The fifth start should be refused with the limit message.
* To see the grader pick, start a general-purpose helper with a change-making task; the toast should say sonnet and give a short reason.
* The router does not write to the flight recorder, so there is no log entry to look up.

## Known limits

* The count can drift. It only comes down on a completed turn that carries a helper id. If a helper ends in a way that does not produce that event, the router can believe it is still running, and may refuse new ones until the session restarts. The count is held in memory and resets with the process. (Read from the code; not shown by testing.)
* The grader sees only the task text. A short brief that hides a hard job may be sent to Haiku.
* A caller-chosen model other than Opus is never checked. Naming a model the account cannot use is the caller's mistake to find.
* The grader call itself costs a little each time (a Haiku call with 120 tokens at most). Types listed in `byType` and caller-chosen models skip it.
* Claude is told to split work but the router does not force it; the nudge is advice.
* The plugin description in `plugin.json` says "Opus for hard ones". The code never picks Opus.

## Details

* `mods/subagent-router/hooks/register.ts`: `register` with three hooks: `agent.spawn` (cap, model choice, toast), `prompt.compose` (adds the section), `turn.complete` (decrement). Helper functions `parseModel` (reads the grader's JSON; rejects anything but haiku or sonnet) and `byType` are exported for tests.
* `mods/subagent-router/.claude-plugin/plugin.json`: name `subagent-router`, version 0.1.0.
* Events and fields used: `e.model`, `e.subagentType`, `e.prompt`, `e.description`, `e.agentId`; `$.model.complete`, `$.ui.toast`.
