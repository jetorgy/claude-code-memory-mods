# Start here

This is the entry point for people and for AI agents. It says what the project is, how to answer common questions, and links every doc.

## What this project is

Four Claude Code "mods" (plugins) that give Claude a memory of your own past sessions and a few guard rails:

- **session-memory** reads your saved sessions into a searchable memory, attaches the few best matches to each message, remembers failed tool calls and their fixes, and compacts the chat at 150,000 tokens.
- **model-selector** sets effort per message, shows which model would fit (it assumes Sonnet and does not switch your real model; `/model` does), adds short guidance notes, and can use an optional local model for small jobs.
- **subagent-router** puts helper agents on Haiku or Sonnet and allows four at once.
- **research** is a switchable research workflow with a notebook on disk, plus a research pool in memory.

It was vibe coded (Claude wrote the code under direction of a non-programmer) and tested only on Linux Mint 22.3. No token savings are claimed because none have been measured. Read [../SAFETY.md](../SAFETY.md) and [why/vibe-coded-and-limits.md](why/vibe-coded-and-limits.md) before relying on it.

## If you are an agent answering a question

| Question | Read |
|---|---|
| What does it read, write, send? | [../SAFETY.md](../SAFETY.md), [reference/files-on-disk.md](reference/files-on-disk.md) |
| Why 150k, why those window sizes, why those numbers? | [why/index.md](why/index.md) |
| Something does not work | [reference/troubleshooting.md](reference/troubleshooting.md), then the flight recorder: [extras/flight-recorder.md](extras/flight-recorder.md) |
| How do I change a setting? | [reference/configuration.md](reference/configuration.md) |
| How do I install or remove it? | [install/installer.md](install/installer.md), [install/setup-prompt.md](install/setup-prompt.md) |
| What does a word mean? | [reference/glossary.md](reference/glossary.md) |
| How do the parts fit together? | [reference/architecture.md](reference/architecture.md) |

Rule for answering: trust the code over any doc. The docs state where each value lives (file and function). If a doc and the code disagree, say so.


## Session memory (the core)

- [session-memory/active-window-and-compaction.md](session-memory/active-window-and-compaction.md): Active window and compaction
- [session-memory/handoff.md](session-memory/handoff.md): Handoff
- [session-memory/lessons-and-corrections.md](session-memory/lessons-and-corrections.md): Two tools let the memory learn from feedback.
- [session-memory/off-switch.md](session-memory/off-switch.md): Type `/memory-off` and the mod stops: no recall, no notes added to prompts, no window, no saving of new memory, no automatic compaction. Type `/memory-on` and it starts a…
- [session-memory/reading-sessions.md](session-memory/reading-sessions.md): Every Claude Code session leaves a transcript file on disk. The indexer reads those files and splits them into small pieces called nodes: one for each request you typed, …
- [session-memory/recall.md](session-memory/recall.md): When you send a message, the mod searches memory for past items that relate to it and attaches the best few to your message as a block labelled "MEMORY RECALL, NOT A REQU…
- [session-memory/search-tools-and-commands.md](session-memory/search-tools-and-commands.md): Automatic recall brings back memories on its own. These tools are for when you or Claude want to ask on purpose.
- [session-memory/strength-and-crystallization.md](session-memory/strength-and-crystallization.md): Every content memory carries a number between 0 and 1 called its strength. Recall uses it to rank: a strong memory scores a little higher than a weak one. The number chan…
- [session-memory/tool-call-memory.md](session-memory/tool-call-memory.md): Tool-call memory

## Research

- [research/aha-line.md](research/aha-line.md): Aha line
- [research/repeat-block.md](research/repeat-block.md): Every web search query is written to a log. When Claude is about to run a `WebSearch`, the memory compares the new query with the logged ones. If one is a close match, th…
- [research/research-map.md](research/research-map.md): Research map
- [research/research-pool.md](research/research-pool.md): The research pool is a separate shelf in the session memory. Anything saved to it is split into short notes, roughly one paragraph each, and every note keeps three labels…
- [research/workflow.md](research/workflow.md): Research workflow

## Model selector

- [model-selector/gpu-watcher.md](model-selector/gpu-watcher.md): The local model sits in GPU memory while it is in use. If you start a game, a render or a CAD session, it would compete for that memory. The watcher checks free GPU memor…
- [model-selector/guidance-notes.md](model-selector/guidance-notes.md): After a request is graded (see routing.md), the mod can attach a short note to your message. There are two notes. One asks Claude to ask you a few questions…
- [model-selector/local-model.md](model-selector/local-model.md): The mods make many small judgement calls (grading a request, polling effort). With a local model these run on your own computer instead of calling a cloud model. The mod …
- [model-selector/routing.md](model-selector/routing.md): When you send a message, the mod asks a small, cheap model to read it and say what kind of work it is. From that answer it chooses which model should do the work and how …

## Subagent router

- [subagent-router/overview.md](subagent-router/overview.md): Sub-agent router

## Extras

- [extras/flight-recorder.md](extras/flight-recorder.md): The session-memory and model-selector mods make many small decisions that you never see: what was recalled, which model graded a prompt, whether the local model or Haiku …

## Install

- [install/installer.md](install/installer.md): The installer copies the four mods into your Claude home folder (`~/.claude` by default), installs their one library, adds the mod paths to Claude Code's `settings.json`,…
- [install/setup-prompt.md](install/setup-prompt.md): `SETUP-PROMPT.md` is a script written for Claude, not for a person to run. You paste it into a new Claude Code session, or say "follow SETUP-PROMPT.md in this folder". Cl…

## Reference

- [reference/architecture.md](reference/architecture.md): Claude Code loads each mod as a plugin. A mod is a TypeScript file (`hooks/register.ts`) that attaches handlers ("hooks") to events in a session: a session starting, a me…
- [reference/configuration.md](reference/configuration.md): The mods work with no configuration. This page lists what you can change when you want to. There are three places: a JSON file for memory recall, environment variables, a…
- [reference/files-on-disk.md](reference/files-on-disk.md): This page is a map. Use it to find where memory is kept, what can be deleted safely, and what the installer touches.
- [reference/glossary.md](reference/glossary.md): Defines each term once, so the other pages can use it without stopping to explain.
- [reference/troubleshooting.md](reference/troubleshooting.md): A lookup table. Find the symptom you see, read the cause, apply the fix. The first section is "first checks", which solves most problems.

## Why it is built this way

- [why/active-window-sizes.md](why/active-window-sizes.md): Why the active window is 20 exchanges (range 6 to 40, 40,000 characters)
- [why/auto-compact-150k.md](why/auto-compact-150k.md): Why auto-compaction fires at 150,000 tokens
- [why/index.md](why/index.md): Why the mods are set up this way
- [why/model-routing.md](why/model-routing.md): Why prompts and helper agents are routed to cheaper models
- [why/off-switch-user-only.md](why/off-switch-user-only.md): Why only the user can turn the memory off
- [why/private-local-ollama.md](why/private-local-ollama.md): Why a private local Ollama on port 11435 with gemma4:e4b
- [why/read-only-and-install-safety.md](why/read-only-and-install-safety.md): Why the mods are read-only and the installer is cautious
- [why/recall-limits.md](why/recall-limits.md): Why recall is limited to these numbers
- [why/research-guards.md](why/research-guards.md): Why research has repeat checks and bridge thresholds
- [why/strength-constants.md](why/strength-constants.md): Why memories have a strength with these constants
- [why/vibe-coded-and-limits.md](why/vibe-coded-and-limits.md): Why these docs say "not verified": how the mods were made, and what is unproven
