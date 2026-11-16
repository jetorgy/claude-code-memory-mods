# Architecture

How the four mods, the helper scripts and the optional local model fit together.

Related: [configuration.md](configuration.md), [files-on-disk.md](files-on-disk.md), [glossary.md](glossary.md), [troubleshooting.md](troubleshooting.md), [../model-selector/routing.md](../model-selector/routing.md), [../model-selector/local-model.md](../model-selector/local-model.md), [../install/installer.md](../install/installer.md)

## What it does

Claude Code loads each mod as a plugin. A mod is a TypeScript file (`hooks/register.ts`) that attaches handlers ("hooks") to events in a session: a session starting, a message being sent, a tool being called, a turn finishing. Handlers can add context, add a status line, change a model, or hold a tool call. Heavy work is done by small Node scripts that the hook starts as separate processes.

## Why

Keeping the hook thin and the work in scripts means a slow or crashing script cannot take the session down. Every script call has a timeout, and a failure means the original message or tool call goes through untouched.

## How

### The four mods

| Mod | Job | Hooks it uses |
|---|---|---|
| session-memory | recall past work, hand off between sessions, compact long chats, watch tool calls, give Claude memory tools | session.start, prompt.submit, tool.call, turn.complete, session.compact, command.run, agent.offer |
| model-selector | choose model and effort per message, add guidance notes, run the local model | session.start, command.run, prompt.submit, turn.complete, tool.call, turn.step |
| subagent-router | pick Haiku or Sonnet for helper agents and cap how many run at once | agent.spawn, prompt.compose, turn.complete |
| research | switchable research workflow with files on disk | session.start, tool.call, command.run, prompt.submit |

### Support pieces

- Flight recorder (`extras/flight-recorder/rec.mjs`): any mod can append one JSON line per decision. It never throws.
- Local launcher (`extras/local-llm/ensure.sh`): starts a private Ollama on 127.0.0.1:11435.
- GPU watcher (`mods/model-selector/engine/gpuwatch.mjs`): gives GPU memory back.
- Installer (`install/install.mjs`) and checks (`tools/*.sh`).

### Life of one message

1. You send a message. `prompt.submit` runs in each mod that has the hook.
2. session-memory runs `recall.mjs` (5 s timeout) with your text and the project folder. A match, or a handoff from earlier sessions, is added as context. It also asks `research-map.mjs` for a related lead.
3. model-selector grades the request with a small model, chooses a model and effort, and may add a guidance note.
4. Claude works. Each tool call passes through session-memory's `tool.call` hook, which can hold a call that failed before, or add a note after it. WebSearch and WebFetch results are saved into the research pool.
5. subagent-router decides the model for any helper agent that is spawned.
6. At `turn.complete`, session-memory may start the background indexer and, past 150000 tokens, compacts the chat after saving it.

### Data flow in one picture

```
 session logs (~/.claude/projects)
        |  index.mjs (every 20 s while active)
        v
 memory.json  <---- mark / correct_memory (Claude's tools)
        |  recall.mjs, callmem.mjs, toolhint.mjs, errors.mjs
        v
 context notes added to your message or a tool result
```

The model-selector sits beside this flow. It grades each message and sets the model and effort, and does not read the memory.

### Session-memory engine scripts

All live in `mods/session-memory/engine/`: `index.mjs` (reads session logs), `recall.mjs`, `callmem.mjs` (recall for a tool call), `toolhint.mjs`, `errors.mjs`, `mark.mjs`, `correct.mjs`, `embed.mjs`, `window.mjs`, `research.mjs`, `research-map.mjs`, `trail.mjs`, `active.mjs`, `strength.mjs`, `retag.mjs`, `parse.mjs`, `marks-apply.mjs` and the shared `store.mjs`.

### Tools registered for Claude

session-memory registers `mark`, `search`, `correct_memory`, `research_map`, `research_query`, `research_ingest`, `session_trail` and `investigate_error`. research registers `research_start`, `research_log` and `research_stage`. Their schemas are in the prompt from the start (`isDeferred: false`).

## Limits and settings

- A hook may run for about 10 seconds of its own time, so work that takes longer is started in the background and its result is delivered later (the error helper works this way).
- Budgets keep memory quiet: 10 items per turn across all lookups, 3 separate tool-call notes, and a small topic budget of 3 refilled by one every 10 calls.
- Module variables (modes, switches) do not survive `/reload-plugins`. Anything that must survive is a file.

## How to see it working

- The status line shows short messages such as "memory: 2 past items attached".
- `~/.claude/flight-recorder/log.jsonl` lists every decision with its source.
- `/recall stats` and `/route` show state.

## Known limits

- Only `hooks/register.ts` is checked by `claude plugin validate`. A mod that fails to load is skipped silently, so check the status line or the recorder after a reload.
- Compaction from a hook has to go through `$.command.run({command:'compact'})` on hosts without a direct compact call.
- Each mod is independent. Turning one off (for example `/memory-off`) does not stop the others.

## Details

- A mod must not keep a `$` member in a variable (`const p = $.process`). Call `$.process.run(...)` directly. Source of the rule: [../HOW-IT-WORKS.md](../HOW-IT-WORKS.md).
- session-memory constants: `RECALL_TIMEOUT_MS` 5000, `INDEX_TIMEOUT_MS` 300000, `INDEX_EVERY_MS` 20000, `COMPACT_AT` 150000, `COMPACT_COOLDOWN_MS` 300000.
- session-memory registers commands `recall`, `memory-off`, `memory-on`; model-selector registers `route` and `local`; research registers `research`.
- Tool-call hooks in session-memory exist per tool for mark, search, correct_memory, research_map, research_query, research_ingest, session_trail, investigate_error, WebSearch and WebFetch, plus one generic hook for everything else.
- The fixer agent (`session-memory:fixer`) is hidden from the offered agent list with `agent.offer`.
- The model cannot switch the memory off: the generic `tool.call` hook refuses writes to the `disabled` file (see `switchAttempt` in `mods/session-memory/hooks/register.ts`) and switch talk is never shown back from memory.
- subagent-router: `MAX_RUNNING` 4; Explore and claude-code-guide helpers get Haiku, all others are graded by Haiku with a default of Sonnet; Opus is never chosen.
