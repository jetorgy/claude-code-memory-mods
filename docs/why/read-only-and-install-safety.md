# Why the mods are read-only and the installer is cautious

One line: the mods only read your sessions, keep all data local, change one settings key (with a backup), and never download or install anything unless you ask.

Related: [../session-memory/privacy.md](../../SAFETY.md), [../reference/configuration.md](../reference/configuration.md), [private-local-ollama.md](private-local-ollama.md), [off-switch-user-only.md](off-switch-user-only.md)

## The choice (from `install/install.mjs`, `SAFETY.md` and the engine)

Installer:
- Writes one merged settings key, `env.CLAUDE_CODE_PLUGIN_DIRS` (and `autoCompactWindow` with `--autocompact`, only if you have not set it).
- Backs up first: `settings.json.bak-pre-memory-mods-<stamp>`.
- Options: `--dry-run` (show, change nothing), `--uninstall`, `--delete-data`.
- Never installs Ollama. Downloads models only with `--pull-model` (gemma4:e4b about 9.6 GB, nomic-embed-text about 274 MB).
- `CHECKSUMS.sha256` with `tools/verify.sh` lets you check that files are unmodified.

Runtime:
- Session files are only read, never edited.
- Default `excludeProjects` is `['personal', 'session-memory']`, so those are never indexed.
- The memory folder has mode 700 (only you).
- The only network address in the code is `127.0.0.1:11435`. There is no push or upload.
- `SAFETY.md` documents the surface; it says the code is about 3,000 lines, small enough to read.
- Tested only on Linux Mint 22.3 (bash, Node 24, NVIDIA).

## The problem it solves

These mods see everything you type to Claude. A tool with that access has to be easy to check and easy to remove, and must not surprise you with side effects. The risks are: corrupting your settings, leaking private conversations, hidden downloads of large files, and silently indexing projects you consider private.

## Why one settings key and a backup

One key is a small, reviewable change. The merge keeps your existing entries. The timestamped backup means any mistake is undone by copying a file back. `--dry-run` shows the exact change first, `--uninstall` reverses it.

## Why never install Ollama or download without a flag

A model download is about 10 GB. Doing that without being asked would use disk and bandwidth and is the kind of thing a reasonable user would be upset to find. Installing Ollama is a system-level change. Both are left to you. Without them the mods still work with fewer features (keyword-only recall; Haiku grading).

## Why read-only access to sessions

Indexing copies information into the mods' own store; it does not need to write to Claude Code's session files. Read-only means a bug in the mod cannot corrupt your history.

## Why `personal` and `session-memory` are excluded

Evidence level: from the code, plus the owner's global instructions.

`personal` is a project name the owner treats as private (their global instructions say not to open or summarise it unless asked by name). `session-memory` is the mod's own project, excluded so the memory system does not index its own development noise in a loop. Why exactly those two is inferred from the names and instructions, not stated in a comment.

## Why mode 700

Stored memories include prompts and code. A 700 folder keeps other accounts on the same machine out.

## Why no push

The system is single-user and local. There is no remote store, no sync and no telemetry. That is a design boundary, so nothing in this repo can send your text away. It also means no backup of your memory unless you make one.

## Limits (stated plainly)

- Tested on one machine type. Other systems are unverified.
- "About 3,000 lines" is the SAFETY.md figure, not a re-count.
- Checksums detect accidental change, not a deliberate attacker who also replaces the checksum file.
- The mods run code with your permissions inside Claude Code; reading the source is the real safety check.

## Evidence level

From the code and SAFETY.md for every behaviour listed. The reasons are inference, not verified, except where the owner's global instructions are cited.

## Alternatives and trade-offs

- Auto-install everything: easiest, but invasive.
- Edit settings by hand: no tool risk, more user effort.
- Store in the cloud: sync and backup, but sends private data off the machine.
- Index every project: more recall, includes private material.

## How to change it

- Extra exclusions: `excludeProjects` in the memory config; see [../reference/configuration.md](../reference/configuration.md).
- Undo the install: `--uninstall` (add `--delete-data` to remove stored memory too).
- Verify files: `tools/verify.sh`.
