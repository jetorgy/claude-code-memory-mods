# Glossary

Plain-English meanings of the words used across these docs.

Related: [architecture.md](architecture.md), [configuration.md](configuration.md), [files-on-disk.md](files-on-disk.md), [troubleshooting.md](troubleshooting.md), [../model-selector/routing.md](../model-selector/routing.md)

## What it does

Defines each term once, so the other pages can use it without stopping to explain.

## Why

The mods mix ideas from several areas: Claude Code plugins, search ranking, local language models and GPUs. The same word can mean different things in each.

## How

Terms are in alphabetical order. Where a term has a setting or a value, the number is given.

## Terms

**Auto mode.** The default `/route` mode. The session model starts on Sonnet and stays there until you run `/route model <name>`. Effort follows every prompt.

**Autocompact.** Claude Code's own setting `autoCompactWindow`. The installer sets it to 150000 only with `--autocompact`, and only if unset. It is the safety net behind the mod's own compaction.

**BM25.** A standard keyword ranking method. Memory recall uses keyword ranking beside the meaning-based ranking.

**Cold storage.** The file `cold.json.gz`. A memory older than `coldAfterDays` (14) whose strength fell below `coldBelow` (0.1) moves there. Nothing is deleted. Using it again brings it back.

**Compaction.** Replacing a long conversation with a short summary. The mod compacts at 150000 tokens, after saving everything to memory, with a 5 minute cooldown.

**Embedding.** A list of numbers that stands for the meaning of a text. `nomic-embed-text` makes them locally. Two texts with a cosine score of 0.7 or more (`semMin`) count as the same meaning.

**Effort.** How hard the model thinks: low, medium, high or xhigh. The selector never leaves xhigh in place; it clamps to high.

**Flight recorder.** `flight-recorder/log.jsonl`. One JSON line for each mod decision. It rotates at 5 MB.

**Fable.** The strongest model tier in the selector. It is the default for "ambitious" work.

**Guidance note.** Short text added to your message: ask questions first (clarify) or give a complete professional result (expert). See [../model-selector/guidance-notes.md](../model-selector/guidance-notes.md).

**Handoff.** The last few messages of earlier sessions (10 by default, 4200 characters at most) carried into a new session.

**Hook.** A handler a mod attaches to a session event, such as `prompt.submit` or `tool.call`.

**Indexer.** `index.mjs`. It reads session logs into memory. It runs in the background at most every 20 seconds.

**Mod.** A plugin for Claude Code. This repository has four: session-memory, model-selector, subagent-router, research.

**Need.** What the grader says the request is: chat, clarify, simple, scoped, unsure or ambitious.

**Num_gpu.** An Ollama setting for how many model layers go on the GPU. The mod sets 999 (all) at 11500 MB free or more.

**Ollama.** A program that runs language models on your machine. The mods use a private copy on port 11435.

**Pool.** A kind of memory item: lesson, request, correction, response, thinking, tool_call, failure, success, image, research, plus structural pools (group, project, session, helper). Each has its own score statistics.

**Private Ollama.** The second Ollama server on `127.0.0.1:11435`, separate from any Ollama on 11434.

**Recall.** Looking up past memory for the current message and attaching the best few items.

**Router.** The part of model-selector that grades a message and chooses model and effort. Also the name of the subagent-router mod, which does the same for helper agents.

**Scope.** Memory search range: `all` projects (current first) or `project` only.

**Session.** One Claude Code conversation. Its log is a file under `projects/`.

**Strength.** A score that fades as a memory goes unused and rises when it is used again.

**Sub-agent.** A helper Claude started for a part of the work. The router gives it Haiku or Sonnet, never Opus, and allows 4 at a time.

**Tool call.** Claude using a tool (reading a file, running a command). session-memory watches these for repeated failures.

**Toast.** A short pop-up message in the interface.

## Limits and settings

All values here come from the code. If a value is changed in the source, the glossary entry and the matching page in these docs should be updated together.

## How to see it working

- Terms with a file name can be inspected directly (see [files-on-disk.md](files-on-disk.md)).
- Terms with a number can be found in [configuration.md](configuration.md).

## Known limits

- The glossary covers terms as used in these mods. It is not a general guide to Claude Code.

## Details

- Pools: `POOLS` and `CONTENT_POOLS` in `mods/session-memory/engine/store.mjs`.
- Needs and tiers: `mods/model-selector/hooks/register.ts`.
- Defaults for cold storage and handoff: `DEFAULT_CONFIG` in `store.mjs`.
