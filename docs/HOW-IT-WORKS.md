# How it works

A plain-language tour of what the three mods do and why. Built on [`@automacene/liminal-memory`](https://www.npmjs.com/package/@automacene/liminal-memory), the memory library underneath (pools of memory nodes, scoring and ranking). The ideas come from the "darkmind" project: a brain-inspired memory with a small active window plus long-term memory found by relevance.

## The big idea

A Claude Code conversation can't be cleared and restarted every turn the way a local model's can, so it gets long and expensive. These mods keep the conversation light by moving the detail into memory:

* **Memory** (long term): everything you and Claude have said, in every saved session, kept as searchable nodes. Found again by relevance, only when needed.
* **Active window** (short term): after a compaction, the last N whole question-and-answer pairs are shown again in full, so the recent thread is not lost.
* **Compaction** at 150,000 tokens, after saving everything to memory first, so the summary can stay short.

## session-memory

* **Reading sessions.** `engine/index.mjs` reads the saved transcripts in `~/.claude/projects` (read only), only what is new, into pools: requests, answers, thinking, corrections, tool calls, failures, successes, lessons, images.
* **Recall before each message.** It searches the memory for what clearly matches your message and attaches a few short notes, labelled as memory and not a request. Hard limits keep it light: at most 10 items per turn, at most 5 for one tool call, and nothing is shown twice in a session. A weak match shows nothing.
* **Before a tool call.** If a call failed twice in earlier sessions and never worked, it is held once with the known cause. After a call, relevant lessons and known fixes for that exact error are attached. A repeated error nobody fixed triggers a web-search nudge and, if needed, a research helper.
* **Crystallization (reinforcement).** Each time a memory is used, it gets stronger (+0.15). Strength fades with a 7-day half-life. After 20 real reuses its baseline creeps up (capped). A memory that fed an answer you called wrong gets weaker. Stale, unused memories move to cold storage and fade from search but are not lost.
* **Active window** (`engine/window.mjs`). After a compaction the first message gets the last N whole pairs, never clipped. N starts at 40 and tunes itself between 10 and 80: if compactions start arriving faster than the average of the last three, it drops 2 pairs; if slower, it adds 1. A hard ceiling (about 30k tokens) drops whole oldest pairs if ever needed. Memories older than the window's first pair are allowed back into recall after a compaction (`window-cut.json`), since only the summary and the window are in front of the model.
* **Handoff** between sessions: the first message of a new session gets the last exchanges, unresolved errors and saved lessons.
* **Lessons.** The `mark` tool saves "when X, do Y" notes; `correct_memory` fixes or forgets a wrong memory on the spot.
* **Auto-compaction** at 150,000 tokens, through Claude Code's own `/compact`.
* **Off switch.** `/memory-off` and `/memory-on`. The state is a file (`~/.claude/session-memory/disabled`), so it survives restarts.

## model-selector

* Grades each message and picks a model and effort level by a cost-versus-quality rubric. `/route` controls it.
* Adds guidance notes: ask short questions when a request is vague, aim for the professional-complete version of what was asked, and **search the web when stuck or when a precise technical fact can't be checked from the files**.
* The small grading jobs try a **local model** first (`gemma4:e4b` in a private Ollama on port 11435), and fall back to Haiku when it is off, busy or missing. On a card with at least 11.5 GB it forces every layer onto the GPU; on a smaller card it leaves the GPU/CPU split to Ollama. `/local on|off|auto|status|start` controls it.

## subagent-router

Helper agents run on Haiku or Sonnet, never Opus, and at most four at once.

## flight-recorder

`~/.claude/flight-recorder/log.jsonl` gets one line for every decision the mods make (`node ~/.claude/flight-recorder/view.mjs` to read it). It is how problems are found without guessing.

## Know-how learned the hard way

* `claude plugin validate` checks only `hooks/register.ts`. A broken script in `engine/` still passes. The installer runs each engine script directly for that reason.
* In the desktop app, compaction from a hook must use `$.command.run({ command: 'compact' })`; `$.session.compact` and `$.prompt.submit('/compact')` are refused there.
* A mod may not store a `$` member in a variable (`const p = $.process`); always call `$.process.run(...)` directly. A mod that fails to load is skipped silently.
* Module variables reset on `/reload-plugins`. Anything that must survive is a file.
