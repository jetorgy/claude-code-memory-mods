# Aha line

One short note added to your prompt when research already on file touches what you just asked.

Related: [research-pool.md](research-pool.md), [research-map.md](research-map.md), [repeat-block.md](repeat-block.md), [workflow.md](workflow.md), [../session-memory/recall.md](../session-memory/recall.md)

## What it does

When you send a prompt, the memory checks the research pool for anything related. If it finds something, one line is added to what Claude sees, in this form:

`RESEARCH NOTE (memory, not a request; a lead, check it fits): Research on file touches this: research/cad-agents (vision, sketch, solver); research/evolution (similar meaning, cos 0.71).`

It names categories, not contents. It is a pointer: it says "there is saved research on this", and Claude can then search the pool for details. It is not an instruction, and it says so.

The line is shown only if it differs from the last one shown, so it does not repeat on every prompt of the same conversation.

## Why it exists

The research pool is only useful if Claude remembers to look in it. A person who researched a topic last week does not always think "I should check my notes" when a related question comes up. The aha line is the nudge. It is cheap (one short line) and it stays quiet when nothing matches.

## How it works

It runs when a prompt is submitted, and only if the prompt is 12 or more characters. The first 500 characters of the prompt are used. Two checks run, and their results are joined.

### Word check

The prompt is reduced to its terms (4 or more letters, minus common and chat words). A category matches when at least 2 of those terms each appear in at least 2 notes of the category, and at least 2 of those matching terms are 6 or more letters long. The long-word rule keeps short generic words from matching. Up to 3 categories are listed, ranked by how many terms matched, each with up to 3 of the matching terms.

### Meaning check

If the prompt is 40 or more characters, the memory asks the local embedding model for a vector of the prompt, waiting at most 1.5 seconds. It then looks at the 60 nearest research notes. A category not already listed is added when a note has cosine similarity of 0.65 or higher, as `path (similar meaning, cos 0.xx)`. The list stops growing at 4 categories in all. If the embedding service is slow or down, this check is skipped and only the word check counts.

### Showing it

The engine call as a whole has a 5 second limit. If it returns an error (a message starting `session-memory error`) the line is dropped. If the text is the same as the one shown last, it is not shown again (the hook remembers it in a variable, `lastAha`). A prompt that produces no line resets that memory to empty, so the sequence line A, no line, line A shows A twice.

### Order of work in one prompt

On each prompt, the ordinary recall runs first (it searches earlier chats and lessons, and may add the new-session handoff). The aha check runs next, only when the prompt was long enough to search. Its line is appended to the same context list as the recall block, so Claude receives both, labelled differently: recalled items say they are from a past chat or from gathered research; the aha line says it is a lead.

### Worked example (from the rules, not captured from a run)

Say the pool has a category `research/turbine` where "impeller", "backsweep" and "blade" each appear in at least 2 notes. The prompt "How should I set the backsweep on this impeller blade?" has terms backsweep, impeller, blade (and "should", "this" are filtered or short). Two of the matching terms are 6 or more letters (backsweep, impeller), so the category matches and the line names it with those terms. A prompt "fix the blade" has one term in the category and no 6-letter pair, so the word check says nothing; the meaning check is skipped as well because the prompt is under 40 characters.

## Limits and settings

* Prompt minimum 12 characters; prompt text used 500 characters; embedding only from 40 characters.
* Embedding wait 1.5 s; whole call 5 s.
* Word check: 2 terms, each in 2 notes, 2 of them 6 or more letters, top 3 categories.
* Meaning check: cosine 0.65, 60 nearest notes, 4 categories in total.
* There is no preference to switch it off (read from the code). Turning session memory off (see [../session-memory/off-switch.md](../session-memory/off-switch.md)) stops the whole mod's recall, which includes this.

## How to see it working

1. Make sure the pool has research on a topic (a few notes with the same specific words).
2. Send a prompt of a sentence or more that uses those words.
3. Look for the `RESEARCH NOTE` line in the context Claude gets. If your interface does not show injected context, run the engine directly: `node engine/research-map.mjs aha "your prompt text here"`. It prints the line, or nothing.
4. Send a second prompt on the same subject: if the result is identical, it is not shown a second time.

## Known limits

* It is a lead only. The word check matches vocabulary, so a prompt can share words with a category without being about it.
* The word rule needs long words. A prompt made of short words ("fix the gpu fan") will not match.
* The meaning check needs the local embedding model. Without it, expect fewer matches.
* If the same category keeps matching, the line shows once, changes slightly (a different term order or category set), and shows again. The comparison is on the exact text.
* Only research notes are searched, not earlier chats. Those are handled by normal recall ([../session-memory/recall.md](../session-memory/recall.md)).

## Details

* `mods/session-memory/engine/research-map.mjs`, command `aha "<text>"`: `terms`, `build`, then `embedQuery` and `nearest` from `embed.mjs`.
* `mods/session-memory/hooks/register.ts` (about line 450, on `prompt.submit`): length check, call to the engine with a 5 s timeout, `lastAha`, the `RESEARCH NOTE (memory, not a request; a lead, check it fits)` wrapper.

### Reading the line

* `(vision, sketch, solver)` after a path lists the prompt words that matched there. These come from the word check.
* `(similar meaning, cos 0.71)` came from the meaning check. A value near 0.65 is a weak match; the higher it is, the closer the saved note is to the prompt.
* A line may mix both kinds, separated by semicolons, and ends with a full stop.

What Claude should do with it: look in the named category (the `search` tool with `kinds: ["research"]`, or `research_map` with that path), decide whether it fits, and use it or ignore it. Nothing is forced.

