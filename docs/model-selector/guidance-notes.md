# Guidance notes

The short instructions the model-selector mod adds to your message so the chosen model works in the right way.

Related: [routing.md](routing.md), [local-model.md](local-model.md), [../reference/configuration.md](../reference/configuration.md), [../reference/glossary.md](../reference/glossary.md)

## What it does

After a request is graded (see [routing.md](routing.md)), the mod can attach a short note to your message. There are two notes. One asks Claude to ask you a few questions first. The other asks Claude to give a professional-complete answer without growing the scope.

The note is added as context beside your message. It is not shown as something you typed.

## Why

Two failure modes are common. A vague request is answered with a guess, and the wrong thing gets built. A clear request is answered with a thin, amateur result. The notes address each: ask first when the request is unclear, and finish properly when it is clear.

## How

The mod picks a note from the graded need:

- clarify: the clarify note.
- chat: no note at all.
- anything else (simple, scoped, unsure, ambitious): the expert note.
- suggest mode: no note, whatever the need.

### The clarify note

Tells Claude to ask 2 to 3 short questions using the AskUserQuestion tool before doing the work.

### The expert note

Asks for the professional-complete version of the work, at the same scope you asked for. It also says:

- Use WebSearch for precise technical facts, or when struggling (after a second failed attempt).
- Work modestly: do not inflate the job.

## Examples

| You send | Likely need | Note attached |
|---|---|---|
| "thanks" | chat | none |
| "make it better" | clarify | clarify note (questions first) |
| "rename this function in two files" | simple | expert note |
| "add pagination to the list view" | scoped | expert note |
| "redesign the whole sync layer" | ambitious | expert note |

These are illustrations of how the rule works. The grader's real answer depends on the context it is given.

## Limits and settings

- Only the `auto` and `always` modes attach notes. `suggest` and `off` never do.
- `/route` with no argument prints the current mode, and the model if one is set.
- There is no setting to edit the wording. It is in the source (`CLARIFY_NOTE`, `EXPERT_NOTE`).
- A note is guidance, not a command. Claude may still decide differently.

## How to see it working

- Send a vague request such as "make it better". Claude should ask a few questions.
- Send a precise request. The answer should be complete without extra features.
- The flight recorder logs a `guidance` event each time a note is attached (`~/.claude/flight-recorder/log.jsonl`).

## Reading a note in a session

A note reaches Claude as extra context attached to your message, in the same way other mods add their notes. It is guidance written by the mod, not text you typed. If you see Claude asking questions you did not expect, the clarify note is the likely cause, and the `guidance` event in the flight recorder will confirm it.

To stop the notes without turning routing off entirely, use `/route suggest`. To stop everything, use `/route off`.

## Known limits

- The grader decides what counts as unclear. A request it calls clear will not get the clarify note.
- The expert note raises quality, not scope. If you want more scope, say so in the request.
- Notes add a little context to each prompt, so very long sessions carry that cost each turn.

## Details

Source: `mods/model-selector/hooks/register.ts`.

- `CLARIFY_NOTE`: ask 2 to 3 short questions with AskUserQuestion.
- `EXPERT_NOTE`: professional-complete version, same scope; WebSearch for precise technical facts or when struggling (second failed attempt); work modestly.
- `guidanceFor(need)` (exported, line ~295) returns the clarify note for `clarify`, nothing for `chat`, and the expert note for every other need. The `prompt.submit` hook skips the call in `suggest` mode.
- Hook: `prompt.submit` appends the note to the prompt context.
- Flight recorder event: `guidance`.
