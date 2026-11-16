# Troubleshooting

Symptoms, likely causes and fixes for the mods, the local model and the installer.

Related: [configuration.md](configuration.md), [files-on-disk.md](files-on-disk.md), [architecture.md](architecture.md), [../install/installer.md](../install/installer.md), [../model-selector/local-model.md](../model-selector/local-model.md), [../model-selector/gpu-watcher.md](../model-selector/gpu-watcher.md)

## What it does

A lookup table. Find the symptom you see, read the cause, apply the fix. The first section is "first checks", which solves most problems.

## Why

The mods are built to fail quietly: a failure means your message goes through unchanged. That keeps Claude Code usable, but it also means a broken mod can look like a mod that does nothing.

## How

### First checks

1. Run `/reload-plugins` after any install or code change. Nothing loads until then.
2. Run `claude plugin validate` on the mod folder. It checks only `hooks/register.ts`.
3. Look at the flight recorder: `tail -n 20 ~/.claude/flight-recorder/log.jsonl`.
4. Check the status line right after sending a message. Each mod prints a short line there.
5. Run the installer's checks again: `node install/install.mjs --dry-run` and `tools/verify.sh`.

### Symptom table

| Symptom | Likely cause | Fix |
|---|---|---|
| No mod does anything after install | `/reload-plugins` not run, or the mod failed to load (skipped silently) | run `/reload-plugins`; run `claude plugin validate`; read the file for a `$` member stored in a variable |
| `/route` or `/recall` not found | the mod did not load | as above |
| Status says "route: could not grade, model unchanged" | the small-model call failed | try again; check network and login; the event `grade_failed` is in the recorder |
| `/local status` shows the model is not used | not enough free GPU memory, or the server is down | `bash ~/.claude/local-llm/ensure.sh`, read its last line |
| `ensure.sh` prints `failed:ollama is not installed` | Ollama is not present | install it yourself from ollama.com, or set `OLLAMA_BIN` in `local-llm/config.env`; the mods fall back to Haiku |
| `ensure.sh` prints `failed:models folder not available` | `OLLAMA_MODELS` points at a folder that is missing (for example an unmounted drive) | mount the drive or fix `config.env` |
| `ensure.sh` prints `failed:server did not answer` | the server did not start in 12 seconds | read `${TMPDIR:-/tmp}/local-llm.log` |
| Model loads, then vanishes while you play or render | the GPU watcher gave the memory back | expected; see [gpu-watcher.md](../model-selector/gpu-watcher.md) |
| Recall never finds anything | the memory is empty, `excludeProjects` matches, or `minScore` is too high | `/recall stats`; `/recall index`; lower `minScore` |
| Recall finds meaning matches poorly | embeddings not built or model missing | `node ~/.claude/my-mods/session-memory/engine/embed.mjs --status`; pull `nomic-embed-text` |
| Too many memory notes | defaults too wide for your use | lower `maxResults`, raise `minScore`, set `scope` to `project` |
| A memory is wrong | an old, wrong note | use `correct_memory` (Claude's tool) or ask Claude to correct it |
| `/memory-off` seems to do nothing | the model asked to run it, which is refused; only you can switch it | type it yourself |
| A search was "held" | a near-repeat (80% or more) of an earlier query | send the same call again and it runs; or search memory first |
| A tool call was "held" | it failed 2 or more times before and never worked | send the same call again to run it once |
| Chat compacts by itself | context passed 150000 tokens | expected; the summary is short and the detail is in memory |
| Installer exits with 1 | a step reported a problem | read the printed summary; fix that step; run again |
| Installer says Node too old | Node under 18 | install Node 18 or newer |
| `npm install` fails | no network or no `npm` | fix, then rerun the installer |
| `tools/verify.sh` reports a mismatch | a file changed after the checksums were made | stop if you did not change it; if you did, run `tools/make-checksums.sh` |

### Undo

- Turn off one mod's behaviour: `/memory-off`, `/route off`, `/local off`, `/research off`.
- Remove everything: `node install/install.mjs --uninstall`. Add `--delete-data` to delete the memory as well.
- Your `settings.json` backup is `settings.json.bak-pre-memory-mods-<stamp>` in the Claude home.

## Limits and settings

- Modes set by slash commands reset after `/reload-plugins` (except the memory on/off file).
- Fixes that need a code change should be followed by `tools/make-checksums.sh` so verification passes again.

## How to see it working

- After a fix, repeat the action that failed and check the status line or the recorder.
- A healthy local model: `curl -s http://127.0.0.1:11435/api/tags` lists `gemma4:e4b`.
- A healthy memory: `/recall stats` shows non-zero counts.

## Known limits

- A mod that fails to load gives no error in the session. The only sign is that its commands are missing.
- Hooks are limited to about 10 seconds, so slow scripts are cut off and the original message goes through.
- The local model needs about 4500 MB of free GPU memory in auto mode, and loads fully on the GPU from 11500 MB.

## Details

- Silent-load rule: a mod may not store a `$` member in a variable (`const p = $.process` breaks it). Call `$.process.run(...)` directly.
- Compaction started from a hook must be `$.command.run({command:'compact'})`; a prompt that starts with `/` is refused.
- Module variables reset on `/reload-plugins`. Anything that must survive is a file.
- Error text from `ensure.sh` is one of `up`, `started`, `failed:<why>` on the last line.
- The GPU watcher quits after 60 s idle, after 5 consecutive failures, or when no NVIDIA GPU is present.
- Repeat-search hold: `webTool` in `mods/session-memory/hooks/register.ts`, threshold 80 percent (`REPEAT: N%`).
