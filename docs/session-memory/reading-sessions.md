# Reading sessions

The indexer reads your past Claude Code transcripts, read-only, and turns them into searchable memory nodes.

Related: [Recall](recall.md) | [Tool-call memory](tool-call-memory.md) | [Strength and crystallization](strength-and-crystallization.md)

## What it does

Every Claude Code session leaves a transcript file on disk. The indexer reads those files and splits them into small pieces called nodes: one for each request you typed, each answer Claude gave, each stretch of thinking, each tool call, each tool failure and each fix, and each image you pasted. It files the nodes in named pools, groups them by folder and project, and saves them in a memory file so later sessions can search them.

It never changes your transcripts. It only reads them, and only the new part each time.

It also tidies things on the way in:

* It removes memory blocks and system reminders from the text, so the memory does not store its own earlier output.
* It skips harness messages that are not real requests from you.
* It recognises a message of yours that corrects the previous answer, and records it as a correction.
* It pairs a failed tool call with the later call that fixed it.
* It saves pasted images once, under a hash, and points the node at the file.

## Why it exists

A new session starts with no memory of the old ones. The transcripts already hold the answers, the dead ends and the fixes, but they are long and unsorted. The indexer is the step that makes them usable: it cuts them into pieces small enough to rank, labels each piece with where and when it came from, and keeps a record of what it has already read so it never starts over.

Reading is done by plain code, not by a language model. That keeps it cheap, repeatable and private: nothing leaves your machine.

## How it works

1. **Find the transcripts.** The source folder is `$CLAUDE_PROJECTS_DIR`, or `~/.claude/projects` by default. Each project folder holds one `.jsonl` file per session. Helper (subagent) transcripts live in `<session>/subagents/*.jsonl`. Main transcripts are read first, then helpers.
2. **Read only what is new.** For each file the indexer remembers how many bytes it has consumed and how many lines it has seen. It reads the next chunk (up to 8 MB), uses only complete lines, and stops at a half-written last line, which it picks up next time.
3. **Decide where it belongs.** The project is the last folder name of the working directory. A drive such as `/media/X` gives the group X, so related projects sit together.
4. **Make nodes.** Each line becomes zero or more nodes (see the table below). Long text is clipped. Text that is only memory output or harness noise is dropped.
5. **Link them.** Answers link to the request they answered. Failures link to the fix that followed. A recall that was shown with a request links that request to the memories shown.
6. **Save.** Nodes go to `memory.json`. Progress goes to `state.json`. Once an hour, old unused nodes move to cold storage (see [Strength and crystallization](strength-and-crystallization.md)).
7. **Embed.** After indexing, up to 6 seconds are spent adding meaning vectors for new nodes, if the local model is available (see [Recall](recall.md)).

The indexer runs in the background at session start and again after a turn if more than 20 seconds have passed since the last run. A lock file keeps two copies from running together.

### What a node is

| Pool | What it holds |
|---|---|
| request | A message you typed |
| correction | A request that reads as correcting the previous answer |
| response | An answer Claude gave |
| thinking | A block of Claude's reasoning |
| tool_call | One tool call and its input |
| failure | A tool call that failed |
| success | A tool call that worked (kept so a fix can be paired with its failure) |
| image | A pasted image, with a pointer to the saved file |
| lesson | A saved rule or fix from the mark tool |
| research | A web page or search result saved whole |
| session, project, group, helper | Structure nodes that hold the others together |

### The hierarchy

Groups hold projects, projects hold sessions, sessions hold helper runs. Ids are `g:<group>`, `p:<group>/<project>`, `s:<session id>` and `h:<helper id>`. Content nodes carry the session, project, group, working folder and time they came from, plus a pointer back to the exact transcript line.

## Limits and settings

* **Excluded projects.** By default projects whose folder name contains `personal` or `session-memory` are skipped (case-insensitive substring). Change `excludeProjects` in `config.json`.
* **Groups.** A `groups` map in `config.json` overrides the automatic grouping.
* **Clipping.** Requests and answers are clipped to 3000 characters, thinking to 1500, tool results to 1200. The full text stays in the transcript.
* **Off switch.** The file `<claude home>/session-memory/disabled` turns the whole mod off. Only you can create it (type `/memory-off`); the model is refused if it tries.
* **Data location.** `$SESSION_MEMORY_HOME`, or `~/.claude/session-memory`, mode 0700.

## How to see it working

* Type `/recall stats` (or `/recall index`) to run the indexer now and print counts.
* Open `~/.claude/session-memory/last-index.json` to see what the last run added.
* Type `/recall active` to list the active memory by pool.
* Look at `state.json`: each transcript path has an `off` (bytes read) that grows as sessions grow.

## Known limits

* Only complete lines are read, so the last few seconds of a live session appear one run later.
* Text clipped at 3000 characters cannot be searched past that point.
* If a transcript is rewritten rather than appended (for example after a manual edit), the saved offset no longer matches and that file may be read oddly. Deleting its entry in `state.json` makes the indexer re-read it.
* The project name is the last folder only, so two projects with the same folder name on different drives share a name (the group still tells them apart).
* A correction is detected by a pattern match on the start of your message. It will miss unusual wording and occasionally flag a message that was not one.

## Details

### Source and state

* `engine/index.mjs`: `ROOT = $CLAUDE_PROJECTS_DIR || ~/.claude/projects`. Per file `state.files[path] = {off, lines}`. Chunks of 8 MB; only newline-terminated lines are consumed.
* Lock: `index.lock` holds the pid. A lock is stale and cleared if the pid is dead or the file is older than 10 minutes.
* Helper transcripts: `<session>/subagents/*.jsonl`, read after the main transcripts.
* `engine/store.mjs`: paths, config defaults, load and save for `memory.json`, `cold.json.gz`, `state.json`.

### Folder layout (`$SESSION_MEMORY_HOME`)

`memory.json`, `cold.json.gz`, `state.json`, `config.json`, `recalls.jsonl`, `last-index.json`, `index.lock`, `toolindex.json`, `marks.jsonl`, `corrections.json`, `embeddings.json`, `embeddings.bin`, `images/`, `window-cut.json`.

### Placement (`placeOf`)

* project = last segment of the cwd.
* `/media/X/...` gives group X; `/mnt/X/...` gives X.
* `/home/...` gives `config`, `Desktop`, `Documents`, `Downloads` or `home`.
* Anything else gives `other`.
* `config.groups` (fragment map) overrides this. The folder `scratch-workspaces` gives project `scratch`.

### Node ids

| Prefix | Meaning |
|---|---|
| `u:` | request |
| `q:` | queued request |
| `a:<uuid>:<i>` | response, with block index |
| `th:` | thinking |
| `tu:` | tool call |
| `tr:` | failure or success (tool result) |
| `im:<hash>:<parent>` | image |

Metadata on content nodes: `session`, `helper`, `project`, `grp`, `cwd`, `ts`, `src` (`file:line`), `who`, plus `strength`, `lastTouched`, `parent`.

### Cleaning (`engine/parse.mjs`, `engine/index.mjs`)

* `scrub` removes `<session-memory>` blocks, system-reminders and the text "MEMORY RECALL, NOT A REQUEST".
* `NOT_A_REQUEST` drops harness-made messages.
* Corrections: the `CORRECTION` regex is tested on the first 400 characters of a request, and only if there is a previous answer.
* Images: saved once to `~/.claude/session-memory/images/<first 24 hex of sha256>.<ext>`, mode 0600. The node's `image` field points at it, and its text is later extended with "Claude said next: ...".

### Failures and fixes

* `signatureOf(tool, body)`: lowercase, with paths, ids, numbers and quotes removed, cut to 140 characters. A repeated signature raises `count` and reinforces the node.
* A fix is a success of the same tool within 30 minutes, at the same target or inside the same request. It sets `fixedBy`, `fixes`, `lastFixed` and `resolved`.
* Messages that start `SESSION-MEMORY HOLD` are skipped.
* Text form: `<tool> FAILED: ...` and `<tool> ok: ...`.
* `HARNESS_ERROR` is a regex for errors that are not tool bugs: auto-mode classifier, permission denied or declined, "user doesn't want to proceed", tool use rejected, usage limit, stale or outside-viewport refs, request interrupted. These are not counted as failures to learn from.

### Timing

* Started at `session.start` in the background (`hooks/register.ts`, `indexInBackground`).
* `INDEX_EVERY_MS = 20000` between runs after a turn; `INDEX_TIMEOUT_MS = 300000`.
* `embedMissing` budget after indexing: 6000 ms.

### Defaults (`engine/store.mjs`)

`excludeProjects: ['personal','session-memory']`, `coldAfterDays: 14`, `coldBelow: 0.1`, `embeddings: true`, `embedModel: nomic-embed-text`.

### Re-tagging research (`engine/retag.mjs`)

Moves research nodes into category paths using a rule table. It is a dry run unless `--apply` is passed.

### Quick reference: what is read and what is skipped

* Read: user messages, assistant text, thinking blocks, tool calls, tool results, pasted images.
* Skipped: memory blocks the mod itself attached, system reminders, harness messages, projects in `excludeProjects`.
* Never written: your transcripts. The indexer only opens them for reading.
* Private by default: the data folder is mode 0700 and saved images are mode 0600.
* Safe to delete: `memory.json` and `state.json` together make the indexer rebuild from the transcripts (marks, lessons and corrections kept in `marks.jsonl` and `corrections.json` are applied again).
