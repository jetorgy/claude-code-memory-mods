# Model routing

How the model-selector mod grades each request and picks a model and an effort level for it.

Related: [guidance-notes.md](guidance-notes.md), [local-model.md](local-model.md), [gpu-watcher.md](gpu-watcher.md), [../reference/configuration.md](../reference/configuration.md), [../reference/architecture.md](../reference/architecture.md)

## What it does

When you send a message, the mod asks a small, cheap model to read it and say what kind of work it is. From that answer it chooses which model should do the work and how hard that model should think. It then switches the session to that model and effort level. Simple chat gets a small model and low effort. A big, open-ended job gets a strong model and more effort.

It also shows a short line in the status bar (the route it chose) and, in the default mode, a toast when a better model would fit than the one you are on.

## Why

A strong model is slow and costly for "thanks" or "which file was that?". A small model is a poor choice for a risky refactor. Picking by hand every message is tedious, so the mod picks for you and keeps the choice visible.

## How

1. The mod collects context: the recent tasks (at most 12), the last 500 characters of Claude's previous answer, and your request cut to 6000 characters.
2. A small model grades the request on six "needs": chat, clarify, simple, scoped, unsure, ambitious.
3. Each need maps to a default model: chat, clarify and simple use Haiku. Scoped uses Sonnet. Unsure uses Opus. Ambitious uses Fable.
4. Effort is chosen from a few flags the grader also returns (back and forth, costly mistake, walk away).
5. A few correction rules adjust the result (see Details).
6. During a long task, every 4 steps a small model is asked whether effort should go up, down or stay the same.

### The four modes

- `/route model <haiku|sonnet|opus|fable>`: sets the session model now.
- auto (default): the session model starts on Sonnet and stays there; `/route model haiku|sonnet|opus|fable` changes it. Effort follows every prompt. A toast says when a better model would fit.
- always: the model is re-picked on every prompt.
- suggest: no switching and no guidance notes. Only a toast and a status line.
- off: the mod clears its state and does nothing.

Switch with `/route`.

## Limits and settings

- `MODEL_SELECTOR_ONLY` (environment variable) pins every need to one tier: haiku, sonnet, opus or fable.
- The mode is a module variable in the hook, so it resets when plugins are reloaded.
- If grading fails, the model is left as it was. The status line says "route: could not grade, model unchanged" and the event `grade_failed` is logged.

## How to see it working

- Send "hi" in a fresh session: the status line should show a chat route and a small model.
- Send a large multi-file request: the route should move up.
- Look at the flight recorder (`~/.claude/flight-recorder/log.jsonl`) for `grade`, `guidance`, `poll` and `turn_done` events.
- Run `/route` with no argument to see the current mode.

## Known limits

- The grader is a model, so it can be wrong. "When unsure, answer same" is the rule for the effort poll, so a wrong poll tends to do nothing rather than something drastic.
- Effort never goes above high through polling.
- Routing needs a working Haiku call. If that fails, nothing changes.

## Details

Source: `mods/model-selector/hooks/register.ts`.

Hooks used: `session.start` (registers `/route` and `/local`, starts `local-llm/ensure.sh` with a 20 s timeout, shows a toast), `command.run` for `local` and `route`, `prompt.submit`, `turn.complete`, `tool.call`, `turn.step`.

### Needs and defaults

| Need | Default model |
|---|---|
| chat | haiku |
| clarify | haiku |
| simple | haiku |
| scoped | sonnet |
| unsure | opus |
| ambitious | fable |

`strong` is set for unsure and ambitious. `isTask` is false for chat and clarify, so those do not enter the recent-task list as work.

### Effort rule

Applied in this order:

1. low if `backAndForth`, or the need is chat, clarify or simple
2. else high if `costlyMistake`
3. else xhigh if `walkAway`
4. else medium

Then these corrections:

- xhigh is clamped to high.
- A fable model at high effort drops to medium.
- A repeat job that landed on opus becomes sonnet.
- A costly mistake lifts haiku to sonnet, except for clarify.

### Grading call

- Context: recent tasks (max 12), last 500 characters of Claude's last answer (also saved with `$.store` under `lastAnswer:<session>`), request truncated to 6000 characters.
- `maxTokens` is 200.
- On failure: model unchanged, status "route: could not grade, model unchanged", `grade_failed` logged.

### Effort polling

`POLL_EVERY` is 4 steps (`turn.step`). A small model answers up, down or same. The level moves between low, medium and high and never above high. The rubric ends with "When unsure, answer same".

### Mode behaviour

- auto: `sessionModel` starts as `sonnet`; only `/route model <name>` changes it; effort follows each prompt.
- always: re-picks every prompt.
- suggest: toast and status only; `guidanceFor` returns nothing.
- off: clears state.

### Flight recorder events

grade, grade_failed, guidance, poll, turn_done, small_call, local_start.
