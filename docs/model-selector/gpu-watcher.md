# GPU watcher

A small background program that frees GPU memory held by the local model when something else needs it.

Related: [local-model.md](local-model.md), [routing.md](routing.md), [../reference/files-on-disk.md](../reference/files-on-disk.md), [../reference/configuration.md](../reference/configuration.md), [../reference/troubleshooting.md](../reference/troubleshooting.md)

## What it does

The local model sits in GPU memory while it is in use. If you start a game, a render or a CAD session, it would compete for that memory. The watcher checks free GPU memory every 2 seconds. When the free memory plus the memory our own models hold drops below a floor, it unloads our two models.  It then quits by itself once they are not loaded.

## Why

The model is a convenience. Your own work comes first. Waiting for the model's idle timer (minutes) is too slow when a program needs the memory right now.

## How

1. The model-selector mod starts the watcher when the local model is in use. It calls `ensureWatcher` at most once every 60 seconds.
2. The watcher asks `nvidia-smi` (`memory.free`) for free memory and asks the private Ollama (`/api/ps`) which models are loaded.
3. If free memory plus our models' share (`free + ours`) is below 4500 MB and our models are loaded, it sends a keep-alive of 0 for `gemma4:e4b` and `nomic-embed-text`. That unloads them.
4. It logs a `gpu_yield` event to the flight recorder.
5. It stops after 60 seconds with none of our models loaded.

It only ever unloads those two models. It never touches other Ollama models or any other process.

## What "free besides ours" means

`nvidia-smi` reports free memory with our model already loaded. If the model holds 9 GB and 1 GB is free, then 10 GB would be free without it, which is fine. If the model holds 9 GB and 0.5 GB is free but a game later takes 7 GB, then free besides ours falls under 4500 MB and the watcher unloads the model. The test uses the sum so the model does not unload just because it is itself using memory.

## Limits and settings

- Flags: `--start` (launch in the background), `--once` (check once and exit), no flag (run in the foreground loop).
- Check interval 2000 ms. `MIN_MB` is 4500.
- It quits: after 60 s with none of our models loaded, after 5 consecutive failures, or when no NVIDIA GPU is found.
- Only one copy runs. The process id is kept in `local-llm/gpuwatch.pid`.
- Home folder: `CLAUDE_HOME`, default `~/.claude`.

## How to see it working

- `node ~/.claude/my-mods/model-selector/engine/gpuwatch.mjs --once` prints one check as JSON and exits. The installer runs this same command as part of validation.
- `cat ~/.claude/local-llm/gpuwatch.pid` shows the running process id, if any.
- Start a GPU-heavy program while the model is loaded, then look in `~/.claude/flight-recorder/log.jsonl` for `gpu_yield` with `by: 'watcher'`.

## Starting and stopping by hand

You normally never do this, because the mod starts it. For testing:

- Foreground loop (stop with Ctrl+C): `node ~/.claude/my-mods/model-selector/engine/gpuwatch.mjs`
- Background: `node ~/.claude/my-mods/model-selector/engine/gpuwatch.mjs --start`
- One check, then exit: `--once`. It prints a JSON line with `free`, `ours` and `yielded`, and it does unload the models if the check says so.
- `--start` prints `started` or `running`.
- `--once` prints `{"error": ...}` if the GPU or server cannot be read; that is not fatal.
- If a start finds a live process id in `gpuwatch.pid`, it prints `running` and exits, so a second copy never starts.
- On exit the watcher removes the pid file, but only if the file still holds its own process id.

## Related behaviour in the mod

The hook does its own free-memory check before each local call in `auto` mode, so the watcher is a second line of defence for the time between calls, when nothing else is looking at the GPU. Turning the local model off with `/local off` unloads the models at once, and the watcher then exits after its 60 second idle period.

## Known limits

- NVIDIA only. On other GPUs, or none, the watcher exits right away, and the mod relies on its own free-memory check before each call.
- Up to 2 seconds can pass before it notices a drop.
- It cannot stop a program from taking memory. It only releases ours.
- After a yield, the next small call may reload the model if memory looks free again.

## Details

Source: `mods/model-selector/engine/gpuwatch.mjs`. Caller: `ensureWatcher` in `mods/model-selector/hooks/register.ts`.

| Item | Value |
|---|---|
| Check interval | 2000 ms |
| MIN_MB | 4500 |
| Idle quit | 60 s with none of our models loaded |
| Failure quit | 5 consecutive failures |
| No GPU | exits |
| Single copy | `local-llm/gpuwatch.pid` |
| Unloaded models | `gemma4:e4b`, `nomic-embed-text` (keep_alive 0) |
| Logged event | `gpu_yield` with `freeBesidesOurs`, `releasedMb`, `by: 'watcher'` |
| Caller rate limit | `ensureWatcher` at most once per 60 s |

The same 4500 figure is `LOCAL_MIN_FREE_MB` in the hook, so the mod and the watcher agree on the floor.
