# Configuration

Every setting the mods read: the memory config file, environment variables, slash commands and installer flags.

Related: [files-on-disk.md](files-on-disk.md), [architecture.md](architecture.md), [troubleshooting.md](troubleshooting.md), [../install/installer.md](../install/installer.md), [../model-selector/routing.md](../model-selector/routing.md), [../model-selector/local-model.md](../model-selector/local-model.md)

## What it does

The mods work with no configuration. This page lists what you can change when you want to. There are three places: a JSON file for memory recall, environment variables, and slash commands typed in a session.

## Why

Defaults are chosen to keep recall small and quiet, because everything shown back to the model stays in the conversation and is sent again every turn. You may want a wider search, a stricter filter, or to keep a project out of memory entirely.

## How

### The memory config file

Create or edit `session-memory/config.json` inside your Claude home (`~/.claude/session-memory/config.json` unless `SESSION_MEMORY_HOME` is set). Keys you leave out keep their default. If the file is missing or not valid JSON, all defaults are used.

### Environment variables

Set these before starting Claude Code (or before running the installer).

### Slash commands

Typed in a session. Their state is held in the running mod, so it resets on `/reload-plugins`.

## Limits and settings

### config.json keys

| Key | Default | Meaning |
|---|---|---|
| `excludeProjects` | `["personal", "session-memory"]` | project folders whose name contains any of these are never read (case-insensitive) |
| `recallPools` | lesson, request, correction, response, failure, thinking, image, research | which kinds of memory may be shown back |
| `maxResults` | 5 | most items shown per recall |
| `maxChars` | 2400 | most characters shown per recall |
| `minScore` | 0.7 | keyword match score needed (a real match is near 0.9) |
| `embeddings` | true | add meaning-based recall using the local embedding model |
| `embedModel` | `nomic-embed-text` | the embedding model |
| `embedPrefix` | true | use the model's task prefixes |
| `scope` | `all` | `all` = every project, current first; `project` = current project only |
| `groups` | `{}` | map a path fragment to a group name, for example `{"solidcraft": "CAD"}` |
| `coldAfterDays` | 14 | age after which a faded memory may move to cold storage |
| `coldBelow` | 0.1 | strength under which it moves |
| `handoffMessages` | 10 | recent messages carried into a new session |
| `handoffMaxChars` | 4200 | size limit for that handoff |

Keys read by the code that are not in the defaults:

- `semantic`: set `false` to turn off the meaning-based side of recall (`recall.mjs`).
- `semMin`: cosine similarity at which two texts count as the same meaning. Default 0.7.
- `minShare`: share of query terms a hit must match when the query has 4 or more terms (`recall.mjs`). Default 0.5. Tool-call recall (`callmem.mjs`) sets its own value (0.5, 0.6 strict, 0.7 topic) and uses keyword matching only.

### Environment variables

| Variable | Read by | Default | Meaning |
|---|---|---|---|
| `MODEL_SELECTOR_ONLY` | model-selector | unset | pin every need to haiku, sonnet, opus or fable |
| `CLAUDE_HOME` | research, `gpuwatch.mjs` | `~/.claude` | Claude home folder |
| `CLAUDE_HOME_DIR` | installer | `~/.claude` | Claude home folder (same as `--claude-home`) |
| `SESSION_MEMORY_HOME` | session-memory engine, installer | `~/.claude/session-memory` | where the memory is kept |
| `SESSION_MEMORY_EMBED_URL` | `embed.mjs` | `http://127.0.0.1:11435` | embedding server address |
| `CLAUDE_PROJECTS_DIR` | indexer, installer | `~/.claude/projects` | where past sessions are read from |
| `CLAUDE_CODE_PLUGIN_DIRS` | Claude Code (set in `settings.json` by the installer) | none | the mod folders to load |

### Slash commands

| Command | Arguments | Effect |
|---|---|---|
| `/route` | `auto`, `always`, `suggest`, `off`; none shows status | model selection mode |
| `/local` | `auto`, `on`, `off`, `free`, `start`, `status` | local model control |
| `/recall` | `active [kind]`, `<words>`, `stats`, `index` | search or inspect memory |
| `/memory-off`, `/memory-on` | none | stop or restart session-memory (creates or removes the `disabled` file) |
| `/research` | `on`, `off`, `status` | research mode switch |

### Constants in code (not settings)

| Constant | Value | Where |
|---|---|---|
| `LOCAL_FULL_GPU_MB` | 11500 | model-selector |
| `LOCAL_MIN_FREE_MB` | 4500 | model-selector |
| `MIN_MB` | 4500 | `gpuwatch.mjs` |
| `POLL_EVERY` | 4 steps | model-selector |
| `COMPACT_AT` | 150000 tokens | session-memory |
| `COMPACT_COOLDOWN_MS` | 5 minutes | session-memory |
| `MAX_RUNNING` | 4 | subagent-router |
| `RECALL_TIMEOUT_MS` | 5000 | session-memory |
| `INDEX_TIMEOUT_MS` | 300000 | session-memory |
| `INDEX_EVERY_MS` | 20000 | session-memory |
| `TURN_ITEMS` | 10 | session-memory, memory items shown per turn across all lookups |
| `TURN_NOTES` | 3 | session-memory, separate tool-call notes per turn |

## How to see it working

- Edit `config.json`, then send a message. The config is read on each recall.
- `/route` with no argument prints the mode. `/local status` prints the local model state.
- `/recall stats` prints counts.

## Known limits

- Slash command modes are not saved. After `/reload-plugins` they return to defaults (the memory on/off switch is the exception, because it is a file).
- Constants in the table above need a code edit, then a refreshed checksum file (`tools/make-checksums.sh`).
- `maxResults` and `TURN_ITEMS` are different caps: the first limits one recall, the second limits everything shown in a turn.

## Details

- Defaults: `DEFAULT_CONFIG` in `mods/session-memory/engine/store.mjs`. `loadConfig()` merges the file over the defaults.
- Memory home: `HOME` in the same file.
- After a compaction the recall uses `--limit 10` instead of `maxResults`.
- Installer flags are in [../install/installer.md](../install/installer.md).
