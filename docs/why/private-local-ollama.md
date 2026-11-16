# Why a private local Ollama on port 11435 with gemma4:e4b

One line: the mods use their own Ollama server on 127.0.0.1:11435, so grading, embeddings and local chat never leave the computer and never disturb another Ollama.

Related: [../session-memory/local-model.md](../model-selector/local-model.md), [../reference/configuration.md](../reference/configuration.md), [model-routing.md](model-routing.md), [read-only-and-install-safety.md](read-only-and-install-safety.md)

## The choice

- A separate Ollama process at `127.0.0.1:11435`. The only network address in the code is this one.
- Chat/grading model `gemma4:e4b` (about 3.1 GB loaded; about 9.6 GB download). Embedding model `nomic-embed-text` (about 274 MB).
- `think: false`, `num_ctx 4096`, and curl `-m 4`, so a call is short and bounded.
- Memory settings: `keep_alive '3m'` for gemma, `'5m'` for embeddings.
- GPU thresholds: `LOCAL_FULL_GPU_MB = 11500`, `LOCAL_MIN_FREE_MB = 4500`.
- `gpuwatch.mjs` checks every 2 s and quits after 60 s idle.
- `/local on|off|auto` controls it; `off` unloads the models immediately.
- The installer never installs Ollama and downloads models only with `--pull-model`.

## The problem it solves

The mods need small language-model jobs done often: meaning-search embeddings, grading how hard a prompt is, summaries. Doing these with the cloud model would cost money and send private conversation text away. A local model costs nothing per call and keeps text on the machine.

## Why a separate server on 11435

Evidence level: from the owner's own session history.

The owner's machine runs a second Ollama on port 11434, which is a Docker container without GPU access. History records that the Docker one must not be stopped. The mods therefore run their own server on a different port, with the GPU. Using a private server also means the mods can set their own keep-alive and unload policy without touching anything else.

## Why gemma4:e4b

From the code: it is the configured model and it fits in about 3.1 GB. History notes also show a larger `gemma4:12b` being used at one stage, but the code now uses `e4b`. Why `e4b` was chosen over 12b is not recorded; inference, not verified: smaller means faster responses and room alongside other GPU work. Quality against alternatives was not measured here.

## Why those GPU numbers

Evidence level: from the code; no owner history was found, so the reasons are inference, not verified.

- If total GPU memory is at least 11,500 MB, the code asks for all layers on the GPU (`num_gpu 999`). Below that it lets Ollama decide.
- In auto mode, the local model is used only when at least 4,500 MB is free. The model needs about 3.1 GB, so 4,500 leaves headroom.
- The headroom exists so the model does not take memory from a game, Blender or CAD session that you are running. A guess at the intent, supported by the watcher design (below), not by a written statement.

## Why it unloads quickly

`keep_alive '3m'` frees GPU memory three minutes after the last use. `gpuwatch.mjs` polls every 2 seconds, exits after 60 seconds idle, and can unload only the mods' own two models (`keep_alive 0`). It will not touch other loaded models.

## Why `think: false`, `num_ctx 4096`, `-m 4`

Short grading and summary calls do not need reasoning traces or a long context, and a hard 4 second cap keeps a slow call from stalling your prompt. If the local call fails or times out, the caller falls back (for model choice, to Haiku; for recall, to keyword-only).

## Privacy

Everything is on `127.0.0.1`. The code does not contact any other host. The installer reads sessions read-only and never pushes anything. See [read-only-and-install-safety.md](read-only-and-install-safety.md).

## Alternatives and trade-offs

- Cloud embeddings and grading: better models, but costs and sends text out.
- Share the existing Ollama: one less process, but its port is the Docker no-GPU one and stopping or reconfiguring it is off limits.
- Bigger local model: better grading, more GPU memory and slower.
- Keep the model loaded all day: instant response, but holds 3+ GB of GPU memory.
- Cost of this choice: you must install Ollama yourself and download ~10 GB.

## How to change it

- `/local on|off|auto` per session.
- Model name, port, thresholds: constants in `model-selector/hooks/register.ts` and the memory config; see [../reference/configuration.md](../reference/configuration.md).
- Keep-alive: the `keep_alive` values in the code. `/reload-plugins` after editing.
