# Search tools and commands

The memory tools Claude can call, and the slash commands you can type, for looking things up in memory by hand.

Related: [reading-sessions.md](reading-sessions.md), [recall.md](recall.md), [tool-call-memory.md](tool-call-memory.md), [strength-and-crystallization.md](strength-and-crystallization.md), [../research/research-pool.md](../research/research-pool.md), [../reference/configuration.md](../reference/configuration.md), [../reference/files-on-disk.md](../reference/files-on-disk.md), [../extras/flight-recorder.md](../extras/flight-recorder.md)

## What it does

Automatic recall brings back memories on its own. These tools are for when you or Claude want to ask on purpose.

Tools Claude can call (all registered, none deferred):

| Tool | Use |
|---|---|
| `search` | Search memory by text, optionally by kind and scope |
| `session_trail` | Show the paper trail of one earlier session |
| `mark` | Record a judgement on an exchange (see [lessons-and-corrections.md](lessons-and-corrections.md)) |
| `correct_memory` | Fix or forget one memory (same doc) |
| `investigate_error` | Send a helper to find the cause and fix of an error |
| `research_ingest`, `research_map`, `research_query` | The research pool (see [../research/research-pool.md](../research/research-pool.md)) |

Slash commands you can type:

| Command | Use |
|---|---|
| `/recall` | Help, search, `active`, `stats` |
| `/memory-off`, `/memory-on` | Switch the whole mod (see [off-switch.md](off-switch.md)) |

## Why it exists

Automatic recall depends on the prompt matching a memory. When it does not, Claude needs a way to ask ("did we hit this before?") and you need a way to look inside the memory without opening JSON files. `investigate_error` exists for the case where a failure repeats and nobody knows why: instead of retrying blindly, a helper researches it and the answer is saved as a lesson.

## How it works

### search

Arguments: `query`, `kinds` (any of lesson, failure, correction, request, response, image, thinking, research), `limit` (capped at 5), `scope` (`all`, the default, with the current project first, or `project`). It has a 10 second timeout. If nothing clears the match threshold it says `Nothing in memory clearly matches that.` Switch-talk is filtered out of results.

### session_trail

Takes `query` (words from a session's title or project, or an id prefix) or `session`. One match, or a long id, gives a summary:

- a header line with counts,
- Started and Ended times,
- up to 3 corrections, 2 unfixed failures and 3 lessons.

Several matches give a list of up to 10 sessions with their ids; call again with an id. An empty query lists the most recent sessions.

### investigate_error

Arguments: `error` (required, cut at 3,000 characters), `failing_tool`, `tried` (cut at 1,500). It starts a hidden agent, `session-memory:fixer`, which runs on the sonnet model and may only read: Read, Grep, Glob, Bash, WebSearch and WebFetch. The tool returns at once. The finding arrives later, with the next tool result or message. On the next finished turn the mod saves the answer as a lesson: "When <tool> fails with ...: <answer>".

### /recall

- `/recall` or `/recall help`: the help text.
- `/recall active [kind]`: what is currently in use (see below).
- `/recall stats` and `/recall index`: both run the indexer and print its JSON counts.
- `/recall <anything else>`: a search with a 5 second timeout, like automatic recall but on your words.

`/recall active` prints, for example:

```
Active memory: N nodes in use, M in cold storage...
By kind (active / cold): ...
- lesson · solidcraft · 2026-11-10 · strength 0.84 ...
```

`--limit` defaults to 12 and is capped at 30. `kind` narrows it to one pool.

## Limits and settings

| Item | Value |
|---|---|
| `search` results | at most 5 |
| `search` timeout | 10 seconds |
| `/recall <words>` timeout | 5 seconds |
| `/recall active` list | default 12, max 30 |
| `session_trail` list | up to 10 sessions |
| `investigate_error` input | error 3,000 chars, tried 1,500 |
| `investigate_error` helper tools | read-only |

Search covers active memory and cold storage. The tools do nothing while memory is off.

## How to see it working

Ask in a session: "search memory for the Write refusal". Claude calls `search` and you see lines like:

```
Lesson (corrected): Write only overwrites a file already Read in this session ...
```

Type `/recall active lesson` to list the strongest lessons. Type `/recall stats` for counts. From a shell:

```
node mods/session-memory/engine/active.mjs --pool lesson --limit 5
node mods/session-memory/engine/trail.mjs --q blender
```

A started investigation shows in the flight recorder and as a helper agent in the session. When the answer arrives, a `lesson` appears in `/recall active lesson` with the text "When <tool> fails with ...".

## Known limits

- `search` returns at most 5 results, even if more are asked for.
- Matching needs a close enough score; vague queries return "Nothing in memory clearly matches that." instead of weak guesses.
- `investigate_error` is asynchronous. If the session ends before the helper finishes, the finding is lost.
- The helper cannot edit files, so it can suggest a fix but not apply it.
- `/recall stats` and `/recall index` run the indexer, so on a large memory they can take a few seconds.
- `session_trail` matches titles and project names loosely; a common word may give a list instead of one trail.
- Commands are registered at session start. A change to command code needs a new session.

## Details

- `hooks/register.ts`
  - `TOOLS` list: `mark`, `search`, `research_map`, `research_query`, `research_ingest`, `investigate_error`, `correct_memory`, `session_trail`; each with `isDeferred: false`.
  - `search` calls `recall.mjs` search mode with `--limit` capped at 5, kinds including `research`, `scope`, 10 second timeout, and returns the "Nothing in memory clearly matches that." text on an empty result.
  - `investigate_error` spawns agent `session-memory:fixer` (model sonnet, tools Read/Grep/Glob/Bash/WebSearch/WebFetch), truncates `error` to 3000 and `tried` to 1500, returns immediately; the `turn.complete` handler turns the finished finding into a lesson.
  - `/recall` command handler: empty or `help` prints help; `active [kind]` runs `active.mjs --pool`; `stats` and `index` run `index.mjs` and print its JSON; otherwise `recall.mjs --q` with a 5 second timeout.
  - Commands registered on `session.start`: `recall`, `memory-off`, `memory-on`.
- `engine/active.mjs`: `--pool`, `--limit` (default 12, max 30). Prints the header lines and `- pool · project · date · strength x.xx` rows, strongest first.
- `engine/trail.mjs`: `--q`, `--session`; matches title and project stems or an id prefix; summary or list as described; filters switch-talk.
- `engine/recall.mjs`: the search tier and ranking (see [recall.md](recall.md)).
- `engine/store.mjs`: `isSwitchTalk`.
- Files: `memory.json`, `cold.json.gz`, `toolindex.json` (see [../reference/files-on-disk.md](../reference/files-on-disk.md)).
