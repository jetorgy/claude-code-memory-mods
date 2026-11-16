# How it works

A plain-language tour of what the three mods do and why. Built on [`@automacene/liminal-memory`](https://www.npmjs.com/package/@automacene/liminal-memory), the memory library underneath (see the next section). The ideas come from the "darkmind" project: a brain-inspired memory with a small active window plus long-term memory found by relevance.

## The library underneath

[`@automacene/liminal-memory`](https://github.com/Automacene/liminal-memory) (Apache-2.0, zero dependencies) does the finding. From its own README:

* It keeps content as **nodes** in named **pools** and searches them with ordinary relevance math: **BM25 keyword ranking** by default, with the tagger and engine swappable (this is how darkmind adds embeddings). It never calls a language model.
* It is **deterministic**: the same pool and the same query return the same nodes every time, and you can point at the reason a node came back. Its stated aim is to take the "finding" step away from the model.
* `rank` gives each hit a **0 to 1 score** with a `minScore` cutoff, so one threshold works for short and long queries. This is what lets a weak match show nothing.
* Different kinds of content go in **separate pools**, because relevance statistics are per pool. That is why the mods keep requests, answers, thinking, corrections, tool calls, failures, successes, lessons and images apart.
* Optional **graph edges** record which nodes were recalled together; they never change ranking, and can decay over time.
* It manages the node lifecycle and nothing else. It does not decide what to store, does not persist by itself, and leaves tagging and content to the caller.

What this repo adds on top is everything else: reading your session files, the recall notes, the reinforcement and decay of memory strength, lessons, the active window, compaction and the commands. The library knows nothing about Claude Code.

## The big idea

A Claude Code conversation can't be cleared and restarted every turn the way a local model's can, so it gets long and expensive. These mods keep the conversation light by moving the detail into memory:

* **Memory** (long term): everything you and Claude have said, in every saved session, kept as searchable nodes. Found again by relevance, only when needed.
* **Active window** (short term): after a compaction, the last N whole question-and-answer pairs are shown again in full, so the recent thread is not lost.
* **Compaction** at 150,000 tokens, after saving everything to memory first, so the summary can stay short.

## session-memory

* **Reading sessions.** `engine/index.mjs` reads the saved transcripts in `~/.claude/projects` (read only), only what is new, into pools: requests, answers, thinking, corrections, tool calls, failures, successes, lessons, images.
* **Recall before each message.** It searches the memory for what clearly matches your message and attaches a few short notes, labelled as memory and not a request. Hard limits keep it light: at most 10 items per turn, at most 5 for one tool call, and nothing is shown twice in a session. A weak match shows nothing.
  * **Keyword plus meaning.** Matching is keyword (BM25, from the library) plus, when available, meaning: `engine/embed.mjs` asks a local embedding model (`nomic-embed-text` in the private Ollama on `127.0.0.1:11435`) for a vector of your question and compares it with stored vectors for lessons, corrections, requests, answers and failures (`embeddings.json` and `embeddings.bin` beside the memory; about 14 MB for 4,600 memories). A keyword match must share your words; a match by meaning (cosine 0.70 or more) does not. Meaning can only raise a keyword hit's score, never lower it, and a meaning-only find scores 0.77 to 0.9.
  * **Where this comes from.** It follows the author's darkmind project: BM25 and cosine blended, with BM25 left calibrated rather than normalised to the best hit. Two differences, both measured on real memory: cosine is rescaled to nomic's real range (unrelated text tops out near 0.65, matches sit at 0.68 to 0.80), and the keyword word-share gate is kept, because raw BM25 scores a single everyday word like "good" at 0.97.
  * **Fallback.** Tool-call lookups stay keyword-only, for speed. If the local model is off or missing, recall is keyword-only and nothing breaks. `"embeddings": false` in `config.json` turns the semantic part off.
* **Before a tool call.** If a call failed twice in earlier sessions and never worked, it is held once with the known cause. After a call, relevant lessons and known fixes for that exact error are attached. A repeated error nobody fixed triggers a web-search nudge and, if needed, a research helper.
* **Crystallization (reinforcement).** Each time a memory is used, it gets stronger (+0.15). Strength fades with a 7-day half-life. After 20 real reuses its baseline creeps up (capped). A memory that fed an answer you called wrong gets weaker. Stale, unused memories move to cold storage and fade from search but are not lost.
* **Active window** (`engine/window.mjs`). After a compaction the first message gets the last N whole pairs, never clipped. N starts at 40 and tunes itself between 10 and 80: if compactions start arriving faster than the average of the last three, it drops 2 pairs; if slower, it adds 1. A hard ceiling (about 30k tokens) drops whole oldest pairs if ever needed. Memories older than the window's first pair are allowed back into recall after a compaction (`window-cut.json`), since only the summary and the window are in front of the model.
* **Handoff** between sessions: the first message of a new session gets the last exchanges, unresolved errors and saved lessons.
* **Lessons.** The `mark` tool saves "when X, do Y" notes; `correct_memory` fixes or forgets a wrong memory on the spot.
* **Auto-compaction** at 150,000 tokens, through Claude Code's own `/compact`.
* **Off switch.** `/memory-off` and `/memory-on`. The state is a file (`~/.claude/session-memory/disabled`), so it survives restarts. **Only the user can flip it.** Any talk of switching the memory on or off, in any spelling or with any symbols (`/memory-off`, `memory_off`, `Memory—Off!`, "turn the memory mod off"), is filtered out of everything memory shows back: recall notes, the handoff, the active window, session trails and the search tools. The commands refuse to run if another mod fires them, a tool call that tries them through `Skill` or `SlashCommand` is denied, and so is a shell command or file write that touches the switch file. Every refusal is logged by the flight recorder as `switch_refused`. A few harmless sentences ("memory on the disk") are hidden too; hiding extra is the safe side.

## research

A switchable research mode. Starting a project creates `research/<slug>/` in the working directory (`state.json`, `question.md`, `protocol.md`, `queries.md`, `evidence.md`, `notebook.md`, `report.md`) and walks Claude through six stages, each with an exit gate: clarify, protocol, collect, appraise, iterate, synthesize. Two simulated experts (an estimator and a skeptic) are run as subagents; they share one model, so agreement is never treated as proof.

It works together with session-memory, so install both (the installer does):

* **Research pool.** `research_ingest` splits gathered text into one node per paragraph under a topic path such as `research/evolution/llm-operators`, and later recall labels it RESEARCH. WebSearch results are saved automatically by a hook (under the active project, or `research/web` when none is active).
* **`research_query`** checks a search query against every earlier one and says REPEAT with the date. Matching is word overlap, ignoring word order, so a reworded query can score high.
* **Repeat block.** A WebSearch that matches an earlier query at 80% or more is held once with the match and a pointer to memory. Sending the same call again runs it. Matches of 60 to 79% only add a note. WebFetch gets the note only.
* **`research_map`** lists the categories with key terms and sources, and a **Semantic bridges** section: pairs of sources in different categories that are close in meaning (embedding cosine 0.85 or more, nomic-embed-text in the private Ollama). Notes such as evidence, notebook and report files are skipped. Treat bridges as leads, not proof.
* **Aha line.** At the start of a task, research on file that matches the words (two terms of 6+ letters) or the meaning (cosine 0.65 or more; skipped for prompts under 40 characters) is attached as a lead. If Ollama is down it falls back to words, with a 1.5 s cap.

Not covered yet: WebFetch auto-save has not been tested, and the `research/web` fallback has not been tested.

## model-selector

Set `MODEL_SELECTOR_ONLY=sonnet` (or haiku, opus, fable) in the `env` block of `settings.json` to pin every task to that one model instead of the default tier mapping.

* Grades each message and picks a model and effort level by a cost-versus-quality rubric. `/route` controls it.
* Adds guidance notes: ask short questions when a request is vague, aim for the professional-complete version of what was asked, and **search the web when stuck or when a precise technical fact can't be checked from the files**.
* The small grading jobs try a **local model** first (`gemma4:e4b` in a private Ollama on port 11435), and fall back to Haiku when it is off, busy or missing. On a card with at least 11.5 GB it forces every layer onto the GPU; on a smaller card it leaves the GPU/CPU split to Ollama. `/local on|off|auto|status|start|free` controls it. **It stays out of the way of your own LLM work, by itself.** The models load only when a small job needs them and unload on their own after 3 minutes idle (5 for the embedding model), so an idle session holds no GPU memory. In `auto` mode (the default), if other work takes the card (less than about 4.5 GB left besides the mods' own models), the mods unload theirs and send the small jobs to Haiku, then come back by themselves when the card frees up. A small background watcher (`mods/model-selector/engine/gpuwatch.mjs`, started by the mod, one copy, exits when the models are no longer loaded) checks every 2 seconds, so the models are freed within seconds of something else taking the GPU, not only at your next message. It logs `gpu_yield` in the flight recorder. `/local free` unloads them right now, and `/local off` does that and stops using the local model. The mods only ever touch their own two models (`gemma4:e4b`, `nomic-embed-text`) and never unload anything else on that Ollama.

## subagent-router

Helper agents run on Haiku or Sonnet, never Opus, and at most four at once.

## flight-recorder

`~/.claude/flight-recorder/log.jsonl` gets one line for every decision the mods make (`node ~/.claude/flight-recorder/view.mjs` to read it). It is how problems are found without guessing.

## Know-how learned the hard way

* `claude plugin validate` checks only `hooks/register.ts`. A broken script in `engine/` still passes. The installer runs each engine script directly for that reason.
* In the desktop app, compaction from a hook must use `$.command.run({ command: 'compact' })`; `$.session.compact` and `$.prompt.submit('/compact')` are refused there.
* A mod may not store a `$` member in a variable (`const p = $.process`); always call `$.process.run(...)` directly. A mod that fails to load is skipped silently.
* Module variables reset on `/reload-plugins`. Anything that must survive is a file.
