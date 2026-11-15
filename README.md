# claude-code-memory-mods

**Claude Code forgets between sessions, repeats old mistakes, and loses detail when it compacts. These mods give it a memory of your own past sessions, on your own machine.** [Why you would want this](docs/WHY.md) · [how it works](docs/HOW-IT-WORKS.md)

Three Claude Code mods that give Claude a working memory of your own past sessions, keep long conversations light, and spend models sensibly:

* **session-memory**: a searchable memory of every saved session, recalled by relevance before each message; lessons from past errors; a sliding window of recent exchanges after each compaction; auto-compaction at 150k tokens; `/memory-off` and `/memory-on`.
* **model-selector**: picks a model and effort per message; nudges Claude to ask when a request is vague and to web-search when it is stuck; optional private local model for the small jobs.
* **subagent-router**: helper agents on Haiku or Sonnet, at most four at once.

Plus a flight recorder (a log of every decision the mods make) and a launcher for an optional local model.

Built on [`@automacene/liminal-memory`](https://www.npmjs.com/package/@automacene/liminal-memory).

## Install (easiest)

1. Read [SAFETY.md](SAFETY.md). It lists exactly what the code reads, writes and runs.
2. Open Claude Code and give it the contents of [SETUP-PROMPT.md](SETUP-PROMPT.md). It audits the code first, then installs with your permission at each step, then imports your existing sessions.
3. Run `/reload-plugins`.

## Install (by hand)

```bash
git clone --depth 1 --branch v1.0.0 https://github.com/jetorgy/claude-code-memory-mods
cd claude-code-memory-mods
tools/verify.sh                          # compare every file with CHECKSUMS.sha256
node install/install.mjs --dry-run       # shows every change, makes none
node install/install.mjs                 # installs, validates, imports your sessions
```

Then run `/reload-plugins` inside Claude Code. Needs Node 18 or newer and npm. Linux and macOS shells; developed on Linux.

## Commands

| Command | What it does |
|---|---|
| `/memory-off` / `/memory-on` | Switch the memory mod off or on. It stays that way after a restart. Nothing is deleted. |
| `/recall <words>` | Search your past sessions. `/recall active`, `/recall stats`, `/recall index` also work. |
| `/route` | Control the model selector. |
| `/local on\|off\|auto\|status\|start` | Control the optional local model. |

## The optional local model

The small grading jobs can run on a model on your own machine (`gemma4:e4b`, about 9.6 GB, in a private Ollama on port 11435 that never touches any Ollama you already use). It is optional: without it the mods use Claude Haiku. The setup checks your machine first, installs nothing without asking, and `node install/install.mjs --local-check` shows what your machine can do.

## Uninstall

```bash
node install/install.mjs --uninstall                 # removes the mods; keeps your memory
node install/install.mjs --uninstall --delete-data   # also deletes the memory
```

## More

* [Why you would want this](docs/WHY.md)
* [How it works](docs/HOW-IT-WORKS.md)
* [Safety](SAFETY.md)
* [Setup prompt](SETUP-PROMPT.md)
