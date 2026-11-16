# Files on disk

Every file and folder the mods create or read, where it lives and what it holds.

Related: [configuration.md](configuration.md), [architecture.md](architecture.md), [troubleshooting.md](troubleshooting.md), [../install/installer.md](../install/installer.md), [../model-selector/local-model.md](../model-selector/local-model.md)

## What it does

This page is a map. Use it to find where memory is kept, what can be deleted safely, and what the installer touches.

## Why

The memory holds copies of your conversations, so you should know exactly where it is, who can read it and how to remove it.

## How

The Claude home folder is `~/.claude` unless you changed it. Below, `<home>` means that folder.

### Installed code

| Path | Contents |
|---|---|
| `<home>/my-mods/session-memory` | the memory mod and its engine scripts |
| `<home>/my-mods/model-selector` | the model selector, with `engine/gpuwatch.mjs` |
| `<home>/my-mods/subagent-router` | the sub-agent router |
| `<home>/my-mods/research` | the research mod |
| `<home>/flight-recorder` | `rec.mjs`, `view.mjs`, `log.jsonl`, `log.old.jsonl` |
| `<home>/local-llm` | `ensure.sh`, `config.env`, `gpuwatch.pid` |
| `<home>/settings.json` | gets the mod paths added (backup beside it) |

### The memory folder

`<home>/session-memory/` (or `SESSION_MEMORY_HOME`). The folder is mode 700 and its files are mode 600, so only you can read them.

| File or folder | Holds |
|---|---|
| `memory.json` | the active memory |
| `cold.json.gz` | faded memory moved out of the active set (nothing is deleted) |
| `state.json` | which session logs have been read, and how far |
| `config.json` | your settings (optional) |
| `recalls.jsonl` | a record of what was shown back |
| `last-index.json` | result of the last indexing run |
| `index.lock` | stops two indexers running at once |
| `toolindex.json` | per-tool history of what each exact call did |
| `marks.jsonl` | marks Claude made with the `mark` tool |
| `corrections.json` | corrections made with `correct_memory` |
| `embeddings.json` and `.bin` | local embedding vectors |
| `window-state.json`, `window-cut.json` | the sliding-window tuner |
| `research-queries.jsonl` | search queries already run, to spot repeats |
| `images/` | saved images |
| `disabled` | exists only while the memory is switched off |

### Other files

| Path | Holds |
|---|---|
| `<home>/research-mod-state.json` | whether research mode is on, and the active project slug |
| `<home>/flight-recorder/log.jsonl` | one JSON line per mod decision; rotates at 5 MB to `log.old.jsonl` |
| `<home>/local-llm/config.env` | optional `OLLAMA_BIN`, `OLLAMA_MODELS`, `LOCAL_MODEL` |
| `<home>/local-llm/gpuwatch.pid` | process id of the running GPU watcher |
| `${TMPDIR:-/tmp}/local-llm.log` | log of the private Ollama server |
| `<project>/research/<slug>/` | per-question files made by the research mod |

A research folder holds `state.json`, `question.md`, `protocol.md`, `queries.md`, `evidence.md`, `notebook.md` and `report.md`.

### Read-only inputs

- `<home>/projects/` (or `CLAUDE_PROJECTS_DIR`): the session logs the indexer reads. The mods only read here.

## Limits and settings

- Project folders whose name contains `personal` or `session-memory` are never read (`excludeProjects`).
- The flight recorder keeps one old file only.
- Cold storage is compressed and kept, not deleted. Using a memory again brings it back.

## How to see it working

- `ls -l ~/.claude/session-memory` shows the files and their modes.
- `tail -n 5 ~/.claude/flight-recorder/log.jsonl` shows the latest decisions.
- `node ~/.claude/flight-recorder/view.mjs` is the recorder's viewer.

## Known limits

- Memory is a copy of your conversations. Anyone who can read your account can read it. Keep backups of `session-memory/` as private as the originals.
- Deleting `memory.json` while the indexer runs can leave a partial state. Turn the memory off first.

## Details

- Memory home and file names: `mods/session-memory/engine/store.mjs` (`HOME`, `STATE_PATH`, `CONFIG_PATH`, `LOCK_PATH`, `TOOLINDEX_PATH`, `MARKS_PATH`, `CORRECTIONS_PATH`).
- `ensureHome()` creates the memory folder with mode 0o700 and `images/` the same.
- Flight recorder writes with mode 0o600 and rotates when the file is over 5,000,000 bytes: `extras/flight-recorder/rec.mjs`.
- Uninstall removes the mod folders, `flight-recorder` and `local-llm`. It keeps `session-memory/` unless `--delete-data` is given.
- Installer backups end in `.bak-<stamp>`, and the settings backup is `settings.json.bak-pre-memory-mods-<stamp>`.
