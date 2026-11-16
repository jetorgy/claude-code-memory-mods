# Local model

The optional small model that runs on your own machine and does the cheap grading, so the mods use Haiku only as a fallback.

Related: [routing.md](routing.md), [gpu-watcher.md](gpu-watcher.md), [../install/installer.md](../install/installer.md), [../reference/configuration.md](../reference/configuration.md), [../reference/files-on-disk.md](../reference/files-on-disk.md), [../reference/troubleshooting.md](../reference/troubleshooting.md)

## What it does

The mods make many small judgement calls (grading a request, polling effort). With a local model these run on your own computer instead of calling a cloud model. The mod runs its own private Ollama server on 127.0.0.1:11435, reachable only from this machine. It never touches an Ollama you already run on the usual port 11434.

Two models are used:

| Model | Size | Used for |
|---|---|---|
| gemma4:e4b | about 9.6 GB | grading and polling |
| nomic-embed-text | about 274 MB | memory search embeddings |

## Why

Grading every message with a cloud model adds cost and delay. A local model is free per call. But a game or a render may need your GPU memory, so the mod also gives the GPU back when it is needed (see [gpu-watcher.md](gpu-watcher.md)).

## How

1. At session start the mod runs `local-llm/ensure.sh` (20 s timeout). It starts the private server if it is not up and warms the model.
2. When a small call is needed, the mod checks free GPU memory (in `auto` mode).
3. If there is room, it calls the local model. If not, it unloads its models and uses Haiku.
4. If the local answer is bad or missing, it falls back to Haiku.

### The /local command

| Argument | Effect |
|---|---|
| auto | use the local model only when the GPU has room |
| on | always use the local model |
| off | stop using it and unload its models |
| free | unload the models now, keep the mode |
| start | run ensure.sh now |
| status | show mode and state (the default with no argument) |

## Limits and settings

- `LOCAL_FULL_GPU_MB` is 11500. At or above this much free GPU memory, the model is loaded fully on the GPU (`num_gpu` 999). Below it, Ollama splits the layers between GPU and CPU itself.
- `LOCAL_MIN_FREE_MB` is 4500 in auto mode. Free memory plus what our models already use must reach this value, otherwise the mod unloads and uses Haiku.
- `localMode` is a module variable. It resets to its default when plugins reload.
- `ensure.sh` reads `local-llm/config.env`: `OLLAMA_BIN`, `OLLAMA_MODELS`, `LOCAL_MODEL`.
- It never installs Ollama and never downloads a model. The installer can pull the model, only when you pass `--pull-model`.

## How to see it working

- `/local status` in a session.
- `bash ~/.claude/local-llm/ensure.sh`: the last line is `up`, `started` or `failed:<why>`.
- `curl http://127.0.0.1:11435/api/tags` lists the models the private server has.
- `node install/install.mjs --local-check` reports Ollama, GPU, disk space and whether the models are present.
- The flight recorder logs `local_start` and `small_call` events.

## Known limits

- Without an NVIDIA GPU the model can still run on the CPU, only slower. The mods then prefer Haiku.
- The first call after a cold start can be slow while the model loads.
- The comment in the source for `/local off` says models stay loaded 30 minutes after last use. That figure is the server default set by `ensure.sh`. The per-call setting is shorter (see Details).

## Details

Sources: `mods/model-selector/hooks/register.ts`, `extras/local-llm/ensure.sh` (installed to `~/.claude/local-llm/`), `mods/session-memory/engine/embed.mjs`.

### Constants

- `LOCAL_FULL_GPU_MB = 11500`
- `LOCAL_MIN_FREE_MB = 4500`
- Chat call `keep_alive`: `'3m'`.
- `embed.mjs` `keep_alive`: `'5m'`.
- `ensure.sh`: `OLLAMA_KEEP_ALIVE=30m` for the server, and a warm-up call with `keep_alive` 30m.

### The chat call

`curl -m 4` with `think: false`, `format: 'json'`, `num_ctx` 4096, `temperature` 0. A bad or missing answer falls back to Haiku, which has a 6 s timeout.

### ensure.sh

- Last output line is one of `up`, `started`, `failed:<why>`.
- Reads `config.env` next to it: `OLLAMA_BIN`, `OLLAMA_MODELS`, `LOCAL_MODEL` (default `gemma4:e4b`).
- Host is `127.0.0.1:11435`.
- Looks for `ollama` on PATH, then `~/.local/bin/ollama`, `/usr/local/bin/ollama`, `/usr/bin/ollama`.
- Starts `ollama serve` detached with `OLLAMA_HOST` set to the private address.
- Warms the model only when it is already downloaded.
- Server log goes to `${TMPDIR:-/tmp}/local-llm.log`.

### Embeddings

The embedding endpoint is read from `SESSION_MEMORY_EMBED_URL` (default `http://127.0.0.1:11435`) and the model from config `embedModel` (default `nomic-embed-text`).
