# Safety: what this code does and does not do

Read this before installing. Every claim here can be checked in the code, and `SETUP-PROMPT.md` makes a model check them for you. You do not have to trust this file; it tells you where to look.

## In one paragraph

These are three Claude Code "mods" plus two small helper folders. They add a searchable memory of your own past Claude Code sessions, pick a model and effort level for each message, and cap how many helper agents run at once. Everything runs on your machine. The only network address the code itself contacts is `127.0.0.1:11435`, a private Ollama on your own computer, and only if you choose to set that up. The code does not call any other server, does not send your data anywhere, and installs nothing by itself.

## What it reads

| What | Where | Why |
|---|---|---|
| Your saved Claude Code sessions (read only) | `~/.claude/projects/**/*.jsonl` | To build the memory. It never modifies them. |
| Your Claude Code `settings.json` | `~/.claude/settings.json` | Only by the installer, to add the mod folders (see below). |
| GPU name and memory | `nvidia-smi` | To decide whether the optional local model fits. |

Project folders whose name contains `personal` are never read (a default you can change in `~/.claude/session-memory/config.json`).

## What it writes

| What | Where |
|---|---|
| The memory database (your conversations, as searchable notes) | `~/.claude/session-memory/` (folder permissions `700`, owner only) |
| A decision log, for debugging | `~/.claude/flight-recorder/log.jsonl` (rotates at 5 MB) |
| The installed mods | `~/.claude/my-mods/` |
| The local model launcher and its optional `config.env` | `~/.claude/local-llm/` |
| One merged setting | `~/.claude/settings.json`: adds the mod folders to `env.CLAUDE_CODE_PLUGIN_DIRS`. With `--autocompact` only, also `autoCompactWindow`. A timestamped backup is saved first. |

It writes nothing anywhere else. There is no `sudo`, no `chmod` beyond making its own launcher executable and locking its own data folder, no `eval`, no encoded or minified code. You can confirm with a search for those words.

## What it runs

Its own scripts use Node's `fetch` for one thing, the local embedding model at `127.0.0.1:11435` (`engine/embed.mjs`), and nothing else. The hooks start only these programs: `node` (its own scripts), `curl` (only to `127.0.0.1:11435`), `nvidia-smi` (read only), a background `node` copy of `mods/model-selector/engine/gpuwatch.mjs` (it only asks the private Ollama at `127.0.0.1:11435` to unload the mods' own two models, and stops itself when they are gone), `bash` (only its own `ensure.sh`), and `mkdir`, `touch`, `rm -f`, `test` (only for the on/off switch file). All of it is listed by `grep -rn "process.run" mods`.

## What it sends, and to whom

* **To Anthropic, through your own Claude Code session, as you:** small side jobs (grading how hard your message is, polling effort, researching a repeated error) are sent to Claude models using your normal Claude Code login. That is the same account and the same traffic as when you chat; no other key or service is involved. If a local model is set up, those small jobs go to it instead, on your own machine.
* **To your own local embedding model (optional):** the text of your remembered lessons, requests and answers (first 1,000 characters each) and each question you ask, so recall can match by meaning. It goes to `127.0.0.1:11435`, a private Ollama on your own computer, and nowhere else. The resulting vectors are stored in `~/.claude/session-memory/embeddings.json` and `embeddings.bin`. Without the local model, none of this happens.
* **To anyone else:** nothing. The code contains no other web address.

## Powers worth knowing about (not hidden, but not nothing)

1. **It adds text to your conversation.** Before each message and after some tool calls, it attaches short notes (labelled as memory or guidance, not as your request) that steer the model: what it remembers, advice to search the web when stuck, to ask clarifying questions when a request is vague, and so on. That is the whole point of the mods, and also the reason to read them. `/memory-off` stops the memory notes.
2. **It stores your conversations.** The memory is a database of what you and Claude said and the tool results, including anything sensitive that appeared in a session. It stays on your disk, owner-only. Delete it any time (`--uninstall --delete-data`).
3. **A research helper can use tools.** When the same error keeps happening, the memory mod can start a helper agent with `Read`, `Grep`, `Glob`, `Bash`, `WebSearch` and `WebFetch`, told to research and not change anything. Your normal Claude Code permission settings still apply to what it runs. If you do not want this, turn the mod off or delete the `FIXER` block in `mods/session-memory/hooks/register.ts`.
4. **It can compact your conversation.** Past 150,000 tokens the memory mod saves the conversation to memory and runs Claude Code's own `/compact`.
5. **It can change which model answers.** The model selector chooses a model and effort level per message (`/route` controls it).

## What you should do

1. Read this file, then run the audit in `SETUP-PROMPT.md`, or read the code yourself. It is about 3,000 lines, and the entry points are `mods/*/hooks/register.ts` and `install/install.mjs`.
2. Check the files against `CHECKSUMS.sha256` (`tools/verify.sh`).
3. If the sender gave you a commit hash separately, compare it with `git rev-parse HEAD`. A hash that arrives by a different route than the repo is what makes that check meaningful.
4. Run `node install/install.mjs --dry-run` first. It prints every change and makes none.

## Switching it off and removing it

* `/memory-off` turns the memory mod off at once, and it stays off after a restart. `/memory-on` turns it back on. Nothing is deleted either way. Only you can do this, by typing the command: any remembered text about switching it on or off is never shown back to the model, the commands refuse if another mod fires them, and a tool call that tries to run them, or to create or delete the switch file, is denied (`switch_refused` in the flight recorder).
* `node install/install.mjs --uninstall` removes the mods from your settings and deletes the installed folders. Your memory is kept unless you add `--delete-data`.

## Honest limits

* A model reading this repo's own audit prompt is a convenience, not proof. A prompt that ships with the code could in principle steer the model reading it, which is why this file, the checksums and the commit hash exist: so a person can check without trusting the model.
* Claude Code mods are a newer feature. A future version may change how mods load. The installer's validation step is there to catch that early instead of failing silently.
