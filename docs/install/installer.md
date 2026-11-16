# The installer

What `install/install.mjs` does, its flags, and how to undo it.

Related: [setup-prompt.md](setup-prompt.md), [../model-selector/local-model.md](../model-selector/local-model.md), [../reference/configuration.md](../reference/configuration.md), [../reference/files-on-disk.md](../reference/files-on-disk.md), [../reference/troubleshooting.md](../reference/troubleshooting.md)

## What it does

The installer copies the four mods into your Claude home folder (`~/.claude` by default), installs their one library, adds the mod paths to Claude Code's `settings.json`, checks that the scripts run, and reads your existing sessions into memory. Run it with `--dry-run` first to see the list of changes without making any.

It can also report whether your machine can run the optional local model, download that model, and remove everything again.

## Why

Doing this by hand means copying folders, editing a JSON settings file and checking several scripts. A single script does the same steps the same way each time, makes a backup before it edits anything, and can undo itself.

## How

Run from the repository folder:

```
node install/install.mjs --dry-run     # list the changes, change nothing
node install/install.mjs               # install
```

Then run `/reload-plugins` inside Claude Code. The installer cannot do that for you.

The steps, in order:

1. Preflight: Node 18 or newer and `npm` must be present.
2. Install files: copy the mods and helper folders (below).
3. Install dependencies: `npm install --omit=dev` in the session-memory mod.
4. Merge settings: add the mod paths to `env.CLAUDE_CODE_PLUGIN_DIRS` in `settings.json`.
5. Validate: check every mod and run the scripts once.
6. Import sessions: read your past sessions into memory, then embed them.

### What gets installed

| From | To |
|---|---|
| `mods/session-memory`, `mods/model-selector`, `mods/subagent-router`, `mods/research` | `<claude home>/my-mods/<name>` |
| `extras/flight-recorder` | `<claude home>/flight-recorder` |
| `extras/local-llm` | `<claude home>/local-llm` |

If a copy already exists and differs, the old one is moved to a folder ending `.bak-<stamp>`. These are carried over into the new copy: `node_modules`, `log.jsonl`, `log.old.jsonl` and `config.env`.

## Limits and settings

### Flags

| Flag | Effect |
|---|---|
| `--dry-run` | print what would change; change nothing |
| `--no-import` | skip reading old sessions |
| `--autocompact` | set `autoCompactWindow` to 150000 in `settings.json`, only if it is not already set |
| `--local-check` | report Ollama, GPU, disk and models; install nothing |
| `--pull-model` | download `gemma4:e4b` and `nomic-embed-text` into the private Ollama |
| `--uninstall` | remove what the installer added |
| `--delete-data` | with `--uninstall`, also delete the memory |
| `--claude-home DIR` | use DIR instead of `~/.claude` |

### Environment variables

- `CLAUDE_HOME_DIR`: the Claude home folder (same as `--claude-home`).
- `SESSION_MEMORY_HOME`: where the memory folder lives.
- `CLAUDE_PROJECTS_DIR`: where past sessions are read from.

## How to see it working

- The installer prints a summary at the end. The exit code is 0 when all is well and 1 on any problem.
- After `/reload-plugins`, run `/recall stats` or `node ~/.claude/my-mods/session-memory/engine/active.mjs` to see the imported memory count.
- Run `tools/verify.sh` in the repository to confirm the files match `CHECKSUMS.sha256`.

## Known limits

- It was written and tested on Linux. The memory switch and the GPU parts rely on Linux tools (`test`, `mkdir`, `touch`, `rm`, `bash`, `nvidia-smi`).
- Importing a large history can take a few minutes.
- The installer never installs Ollama. It only reports whether it is present.

## Details

Source: `install/install.mjs`.

### settings.json merge

- Key: `env.CLAUDE_CODE_PLUGIN_DIRS` gets the mod folders added.
- Backup before editing: `settings.json.bak-pre-memory-mods-<stamp>`.
- The file is written to a temporary file and renamed into place, so a crash cannot leave half a file.
- `--autocompact` sets `autoCompactWindow` to 150000 only when the setting does not exist.

### Validation

- `claude plugin validate` for each mod. This checks only `hooks/register.ts`.
- Then: `window.mjs --status`, `recall.mjs --q`, `active.mjs`, `embed.mjs --status` and `gpuwatch.mjs --once`.

### --local-check

Reports whether Ollama is present, the GPU and its memory against the 11500 MB full-GPU threshold, free disk (15 GB is treated as enough), and whether the two models are already downloaded.

### Uninstall

`--uninstall` removes the mod paths from `settings.json`, then deletes the mod folders, `flight-recorder` and `local-llm`. The memory folder is kept unless `--delete-data` is given.

### Checking the repository itself

- `tools/verify.sh`: `sha256sum -c CHECKSUMS.sha256`, plus a check for extra files.
- `tools/make-checksums.sh`: rewrites `CHECKSUMS.sha256` after an edit.
- `tools/check-clean.sh`: looks for data files, personal paths and secrets before publishing.
