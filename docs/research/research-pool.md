# Research pool

Gathered research (web results, papers, notes) is saved as paragraph-sized notes in memory, kept forever, and labelled RESEARCH when it comes back.

Related: [workflow.md](workflow.md), [repeat-block.md](repeat-block.md), [research-map.md](research-map.md), [aha-line.md](aha-line.md), [../session-memory/recall.md](../session-memory/recall.md), [../reference/files-on-disk.md](../reference/files-on-disk.md)

## What it does

The research pool is a separate shelf in the session memory. Anything saved to it is split into short notes, roughly one paragraph each, and every note keeps three labels: a topic path (for example `research/evolution/llm-operators`), where it came from (a source), and why it was gathered. Later, when you ask something related, the memory can bring those notes back, and each one is marked RESEARCH so Claude does not mistake it for something said in an earlier chat.

Notes get into the pool in three ways:

1. Claude calls the `research_ingest` tool with text, or with a file to read.
2. Research mode's `research_log` tool saves everything it logs (notebook, queries, evidence entries) as notes too.
3. A hook saves every `WebSearch` and `WebFetch` result automatically, with no model involved.

## Why it exists

Search results used to live only in one conversation. Once the session ended, or was compacted, the findings were gone and the same searches were run again. Saving them in the memory means a later session, on a different project, can find what was already learned. Splitting into paragraphs keeps each note small enough to be useful when recalled, and "nothing is dropped" means the whole text is kept rather than a summary written by a model.

## How it works

### Splitting

The text is cut at blank lines into paragraphs and whitespace is collapsed. Then:

* A paragraph shorter than 200 characters is merged into the next one.
* A paragraph longer than 1400 characters is cut at a sentence end (". ") before the 1400 mark, or at a space if no sentence end is in the second half, or hard at 1400.
* A short tail at the very end is kept as its own note rather than dropped.

Each note gets an id made from a hash of its text, so saving the same paragraph twice adds nothing. The command reports `Research nodes: N new of M paragraphs (duplicates skipped).`

### Labels on each note

topic, source, session id, path (default `research/<topic>`), why, project (`rproject`), position (`n` of `of`), a timestamp, strength 1. The note's `project` field is always `research`.

### Never faded

The pool is named `research` among the memory pools. Notes in it are not moved to cold storage, and they are one of the pools the recall searches (alongside lessons, requests, corrections and others). They are also eligible for the meaning-based (embedding) search, which is what makes them findable in different words.

### Labelling at recall

When a research note is recalled, it is shown as a "RESEARCH NODE, from gathered research, not a past chat", with its topic, its source, and "part n/m", and a clipped body (700 characters). In the numbered list of recalled items the heading starts with `RESEARCH ·`.

### Automatic web saving

Hooks on `WebSearch` and `WebFetch` (in `mods/session-memory/hooks/register.ts`) save the result after it comes back. The rules:

* The result must be at least 200 characters and not an error.
* If research mode has an active project, the topic is the project slug and the path is `research/<slug>`.
* Otherwise the topic is `web` and the path `research/web`.
* The source label is the query (or URL), cut to 300 characters; the "why" is `auto-saved WebSearch result` or `auto-saved WebFetch result`; at most 100,000 characters of the result are saved.
* It runs in the background and never blocks or changes the call. For a search, the query is also written to the query log used by the repeat block ([repeat-block.md](repeat-block.md)).

### What you can ask Claude to do

`research_ingest` takes `text` or `file`, plus `topic`, `source`, `path` (like `research/cad-agents/vision`), `why` and `project`. Searching the pool: `mcp__session-memory__search` with `kinds: ["research"]`.

## Limits and settings

* Split sizes: 200 and 1400 characters (constants `MIN` and `MAX`).
* Auto-save needs at least 200 characters and truncates at 100,000.
* The ingest command has a timeout of 20 seconds when called through the tool (4 times the 5 second recall timeout).
* Pool memory file: `~/.claude/session-memory/memory.json`; vectors: `embeddings.json` and `embeddings.bin` beside it. See [../reference/files-on-disk.md](../reference/files-on-disk.md).
* There is no setting to turn auto-saving off by itself. Turning the whole session-memory mod off is the only switch (see [../session-memory/off-switch.md](../session-memory/off-switch.md)), but note that the web hooks are registered without the off-switch check in the code, so they may still run while memory is off (read from the code, not tested).

## How to see it working

* Run a `WebSearch`, then in a terminal: `node ~/.claude/my-mods/session-memory/engine/research-map.mjs map` (path depends on where the installer put the mod) and look for a `research/web` or `research/<slug>` category with a `Why gathered: auto-saved WebSearch result` line.
* Or ask Claude to run `mcp__session-memory__research_map`.
* Ingest by hand: `node engine/research.mjs --topic demo --source "my notes" --text "paragraph one ... "` prints the node counts. Run it twice to see duplicates skipped.

## Known limits

* Not yet tested: auto-save of `WebFetch` results, and the `research/web` fallback when no project is active. The code path exists for both.
* Splitting is by blank lines and length. Text with no blank lines (a web page flattened into one line) becomes length-based chunks that may cut mid-thought.
* Saved web text is whatever the tool returned, which for WebFetch is a digest, not the original page.
* Duplicates are detected by exact text only.

## Details

* `mods/session-memory/engine/research.mjs`: `splitParagraphs`, `ingest`. CLI flags `--topic --source --session --path --why --project` and `--file`, `--text` or stdin.
* `mods/session-memory/engine/store.mjs`: `POOLS` includes `research`; the recall pools list includes it.
* `mods/session-memory/engine/embed.mjs`: `EMBED_POOLS` includes `research`.
* `mods/session-memory/engine/recall.mjs` (about lines 201-205 and 350): RESEARCH labelling.
* `mods/session-memory/hooks/register.ts`: `autoIngest`, `webTool`, tool registrations `research_ingest`, `research_map`, `research_query`; hooks on `WebSearch` and `WebFetch`.
