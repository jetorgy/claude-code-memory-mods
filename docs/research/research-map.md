# Research map

A summary of everything in the research pool, grouped by topic, with links drawn between topics that share an idea.

Related: [research-pool.md](research-pool.md), [aha-line.md](aha-line.md), [repeat-block.md](repeat-block.md), [workflow.md](workflow.md), [../reference/files-on-disk.md](../reference/files-on-disk.md)

## What it does

The research map answers "what do I already know, and how does it fit together?" without reading every saved note. It prints:

1. One block per category (a category is a topic path such as `research/cad-agents/vision`). Each block shows how many notes and how many sources it holds, the key terms, why the material was gathered, and the four most-used sources.
2. A list of bridges: pairs of categories that share unusual terms, with the source behind each term.
3. A second list of semantic bridges: pairs of notes from different categories that say the same thing in different words.

You ask for it with the `research_map` tool (optionally with a path to narrow to one branch), or from a terminal.

## Why it exists

A pool of hundreds of paragraphs is hard to survey. The usual failure is not that research was lost, but that two pieces gathered in different places were never put side by side. The map makes those links visible: if a paper about one subject and a note about another both talk about the same mechanism, the map says so and names both sources, so the connection can be checked and used.

## How it works

### Categories

Every research note has a path in its labels. Notes with the same path form a category. For each one the map counts notes and distinct sources and collects the "why gathered" values (up to 3 shown).

### Key terms

For each category, words of 4 or more letters (minus common and chat words) are counted by how many notes contain them. A word needs to appear in at least 2 notes to count. Words are ranked by count multiplied by the log of (1 + the number of categories divided by the number of categories that use the word), so words spread across every category score lower than words particular to one. The top 12 are shown.

### Term bridges

Two categories are linked when they share at least 2 terms that each appear in at least 2 notes of both categories, and the term is used by at most 2 categories in total (so it is rare, not generic). The top 5 shared terms per pair are shown, each with the source it first came from in each category.

### Semantic bridges

If the local embedding vectors exist, every pair of research notes is compared. A pair is shown when:

* the two cosine similarity is 0.85 or higher,
* the notes are in different categories and have different sources, and
* neither source looks like a working file of the research mode (a name ending in `evidence.md`, `notebook.md`, `question.md`, `protocol.md`, `queries.md` or `report.md`), since those restate the topic by design.

Only the best pair for each pair of categories is kept, and the top 12 are shown, as `path <-> path: cos 0.87 (source / source)`. If vectors are missing, or the local embedding service is down, the section is simply left out.

### Narrowing

With a path, only categories whose path starts with it, and bridges that touch one, are shown.

### Example output shape

```
## research/web  (12 nodes, 5 sources)
Key terms: ...
Why gathered: auto-saved WebSearch result
Top sources: ...

## Bridges (terms strong in two categories; each names where it came from)
- research/a <-> research/b: "term" (source one / source two), ...

## Semantic bridges (same idea, different words; local embeddings)
- research/a <-> research/b: cos 0.87 (source one / source two)
```

(This shows the layout produced by the code; the values are placeholders.) The semantic heading and list are printed only when at least one pair was found.

### Who uses the output

The map is for reading, by Claude or by you. It is not fed to recall automatically. The related automatic feature is the aha line ([aha-line.md](aha-line.md)), which uses the same category and word logic against a single prompt.

## Limits and settings

* Thresholds: 2 notes per term, top 12 terms, 4 sources, 2 shared terms and df of 2 or less for term bridges, top 5 terms per pair, cosine 0.85, top 12 semantic bridges. All are constants in `research-map.mjs`; there is no preference for them.
* Semantic bridges need `embeddings.json` and `embeddings.bin` in `~/.claude/session-memory` and a running local Ollama with the `nomic-embed-text` model. See [../reference/files-on-disk.md](../reference/files-on-disk.md).
* The semantic pass compares every pair of notes, so its cost grows with the square of the pool size (read from the code; not timed here).

## How to see it working

* Ask Claude: "run research_map". Or in a terminal, from the mod's folder: `node engine/research-map.mjs map`, or `node engine/research-map.mjs map --path research/web`.
* Check a category block against the pool: its note count should equal the number of `RESEARCH` items for that topic.
* Add two notes in different topics that share rare words, run the map again, and look for the new line under Bridges.

## Known limits

* Key terms are plain word counts, not meaning. A category dominated by one long source will show that source's vocabulary.
* A term used by 3 or more categories is never a term bridge, even if the link is real. The semantic section is the way to catch those.
* Semantic bridges rely on one small local embedding model and a single cutoff (0.85). They are leads to check, not proof.
* Categories are exact path matches. `research/web` and `research/Web` are different categories.
* Large pools make the semantic section slow; there is no cap on how many notes are compared.

## Details

* `mods/session-memory/engine/research-map.mjs`: `build` (categories), `report` (blocks and term bridges), `semanticBridges`, `isNote`, command `map [--path P]`.
* `mods/session-memory/engine/embed.mjs`: `loadVectors`, the vector files.
* `mods/session-memory/hooks/register.ts`: the `research_map` tool, which runs the engine command.
