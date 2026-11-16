# claude-code-memory-mods

**Claude Code forgets between sessions, repeats old mistakes, and loses detail when it compacts. These mods give it a memory of your own past sessions, on your own machine.** [Start here](docs/START-HERE.md) · [why it is built this way](docs/why/index.md)

Four Claude Code mods that give Claude a working memory of your own past sessions, keep long conversations light, and spend models sensibly:

* **session-memory**: a searchable memory of every saved session, recalled by relevance before each message; lessons from past errors; a sliding window of recent exchanges after each compaction; auto-compaction at 150k tokens; `/memory-off` and `/memory-on`.
* **model-selector**: keeps the chat on Sonnet (switch with `/route model <name>`), sets effort per message; nudges Claude to ask when a request is vague and to web-search when it is stuck; optional private local model for the small jobs.
* **subagent-router**: helper agents on Haiku or Sonnet, at most four at once.
* **research**: a switchable research workflow (clarify, protocol, collect, appraise, iterate, synthesize) with a notebook on disk. Web results are saved into a research pool in session-memory, repeat searches are held, and a map shows which topics connect.

Plus a flight recorder (a log of every decision the mods make) and a launcher for an optional local model.

Built on [`@automacene/liminal-memory`](https://www.npmjs.com/package/@automacene/liminal-memory).

## Read this first: who made this, and how

This is an experiment, and it was **vibe coded**: I am not a programmer, and Claude wrote the code under my direction. I believe code like this should be checked by senior developers before anyone relies on it. **Use it of your own free will, at your own risk.** Read [SAFETY.md](SAFETY.md) and the code first (it is small, about 3,000 lines), and check it against `CHECKSUMS.sha256`.

What I can say in its favour:

* It is built on libraries that were created by me and a senior developer with more than 15 years of experience. The memory library underneath is [`@automacene/liminal-memory`](https://www.npmjs.com/package/@automacene/liminal-memory).
* The point of the project is to see whether the same kind of memory system can be built inside Claude Code itself.
* I use it every day, and I keep measuring it (token counts and similar), so I can compare sessions with and without it. I will add real numbers here once I have them; until then no savings are claimed.
* It is designed to get out of the way when you test local models yourself: `/local free` releases the GPU memory the mods use, `/local off` does that and keeps them off, and in the default mode the mods unload their models by themselves when something else needs the GPU (or after a few idle minutes) and use Haiku until it frees up. Memory recall keeps working without the local models (keyword search only).
* If something breaks, Claude Code can fix it, and so can any real developer. Issues and corrections are welcome.

## Install (easiest)

1. Read [SAFETY.md](SAFETY.md). It lists exactly what the code reads, writes and runs.
2. Open Claude Code and give it the contents of [SETUP-PROMPT.md](SETUP-PROMPT.md). It audits the code first, then installs with your permission at each step, then imports your existing sessions.
3. Run `/reload-plugins`.

## Install (by hand)

```bash
git clone --depth 1 --branch v1.1.2 https://github.com/jetorgy/claude-code-memory-mods
cd claude-code-memory-mods
tools/verify.sh                          # compare every file with CHECKSUMS.sha256
node install/install.mjs --dry-run       # shows every change, makes none
node install/install.mjs                 # installs, validates, imports your sessions
```

Then run `/reload-plugins` inside Claude Code. Needs Node 18 or newer and npm. **Tested only on Linux Mint 22.3** (bash, Node 24, an NVIDIA GPU). On any other system, the setup prompt has Claude Code check your system first and adapt the steps with your OK; I have not tested macOS or Windows.

## Commands

| Command | What it does |
|---|---|
| `/memory-off` / `/memory-on` | Switch the memory mod off or on. It stays that way after a restart. Nothing is deleted. |
| `/recall <words>` | Search your past sessions. `/recall active`, `/recall stats`, `/recall index` also work. |
| `/route` | Control the model selector. `/route model haiku\|sonnet\|opus\|fable` changes the session model (it starts on Sonnet). |
| `/local on\|off\|auto\|status\|start\|free` | Control the optional local model. `free` releases its GPU memory now. |

## The optional local model

Two small models can run on your own machine, in a private Ollama on port 11435 that never touches any Ollama you already use: `gemma4:e4b` (about 9.6 GB) for the small grading jobs, and `nomic-embed-text` (about 274 MB) so recall matches by meaning as well as by keyword. Both are optional: without the first the mods use Claude Haiku, and without the second recall is keyword-only. The setup checks your machine first, installs nothing without asking, and `node install/install.mjs --local-check` shows what your machine can do.

## Uninstall

```bash
node install/install.mjs --uninstall                 # removes the mods; keeps your memory
node install/install.mjs --uninstall --delete-data   # also deletes the memory
```

## Documentation

There is one page for each thing the mods do. [docs/START-HERE.md](docs/START-HERE.md) lists them all.

| Folder | What is in it |
|---|---|
| [docs/session-memory/](docs/session-memory/) | Reading sessions, recall, tool-call memory, strength and decay, the active window and compaction, handoff, lessons, commands, the off switch |
| [docs/research/](docs/research/) | The research workflow, the research pool, the repeat block, the map, the aha line |
| [docs/model-selector/](docs/model-selector/) | Routing, guidance notes, the local model, the GPU watcher |
| [docs/subagent-router/](docs/subagent-router/overview.md) | Helper agents and the cap of four |
| [docs/extras/](docs/extras/flight-recorder.md) | The flight recorder |
| [docs/install/](docs/install/) | The installer and the setup prompt |
| [docs/reference/](docs/reference/) | Configuration, files on disk, architecture, troubleshooting, glossary |
| [docs/why/](docs/why/index.md) | Why each number and design choice is what it is (for example, compaction at 150k) |

Also: [SAFETY.md](SAFETY.md) and [SETUP-PROMPT.md](SETUP-PROMPT.md).
