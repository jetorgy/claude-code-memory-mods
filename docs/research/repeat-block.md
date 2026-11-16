# Repeat block

Before a web search runs, memory checks whether a very similar query was already run, and holds the search once if so.

Related: [research-pool.md](research-pool.md), [research-map.md](research-map.md), [aha-line.md](aha-line.md), [workflow.md](workflow.md), [../extras/flight-recorder.md](../extras/flight-recorder.md)

## What it does

Every web search query is written to a log. When Claude is about to run a `WebSearch`, the memory compares the new query with the logged ones. If one is a close match, the memory tells Claude so and what to do about it:

* An 80% or higher match: the search is held, not run. Claude is told to search memory first. If Claude sends the same call again, it runs.
* A 60 to 79% match: the search runs, with a note added saying a similar query was run before and not to repeat it.
* Under 60%: nothing happens.
* A `WebFetch` (a page fetch) is never held. If its URL was seen before it gets only the note.

## Why it exists

Research tends to circle. Claude re-runs nearly the same search in one session, or in a new session that does not remember the last one, and pays for it each time in time and tokens. The results of earlier searches are already saved in memory ([research-pool.md](research-pool.md)), so the cheapest fix is to look there first. The hold is a single gentle stop, not a ban: a genuinely new need goes through on the second try.

## How it works

### Comparing queries

Each query is reduced to a set of terms: lower-case words that start with a letter, are at least 4 characters long, and may contain digits and hyphens. Two word lists, ordinary stop words and chat filler words, are removed. The rest are de-duplicated and sorted. Two queries are compared with Jaccard overlap: shared terms divided by all terms in either. The best score across the whole log is reported, and a score of 0.6 or higher counts as a match.

The result reads `REPEAT: N% match with a query run <date>: "<query>"` plus a pointer to search memory first, or `New query.`

### The log

`~/.claude/session-memory/research-queries.jsonl`, one JSON line per query: `{"ts": <date>, "q": <query>}`. A query is added after a search is auto-saved (and for a fetch, the URL is added). You can add one by hand with the `research_query` tool and `log: true`.

### The hold

In the `WebSearch` hook, a score of 80% or higher denies the call once for that exact query. The text is "Held, not run: search memory first", and says to send the same call again and it will run. The set of already-held queries is kept in the running process, so the second try goes through. 60 to 79%, and every `WebFetch`, add only a `RESEARCH NOTE` to the result.

### What you can ask Claude to do

`mcp__session-memory__research_query` with a query: it says REPEAT with the date, or New query. With `log: true` it records the query as run.

## Limits and settings

* Match threshold 0.6 (the report), hold threshold 80%.
* Terms of 4 or more characters only, so a query of short words ("cpu gpu fan") has few or no terms.
* The hold happens once per query per running session process; restarting clears it.
* No setting turns it off alone. The hooks are not gated by the memory off-switch in the code.

## How to see it working

1. Search for something with `WebSearch`.
2. Search again with nearly the same words. The second call should be refused with "Held, not run".
3. Send it again unchanged. It runs.
4. Or check by hand: `node mods/session-memory/engine/research-map.mjs query "your words"` prints REPEAT or New query. Add `--log` to record it.
5. The log file lists what was recorded: `tail ~/.claude/session-memory/research-queries.jsonl`.

## Known limits

* It compares words, not meaning, and ignores order. "python sort list" and "list sort python" match at 100%. Reworded queries with different words, or very different queries that share most of the same words, can be wrong either way.
* Only queries run through the hooks are logged. Searches done in a browser or another tool are not.
* The hold set is not saved between processes.
* The hold is not written to the flight recorder as its own event (no repeat-hold event exists in the recorder's event list; see [../extras/flight-recorder.md](../extras/flight-recorder.md)).
* A hit shown in the REPEAT line says the earlier results are already in the research pool. That is only true if the earlier search was auto-saved (200 characters or more, not an error).

## Details

* `mods/session-memory/engine/research-map.mjs`: `norm` (terms), `similar` (Jaccard, best match), the STOP and CHAT word lists, the log file path.
* `mods/session-memory/hooks/register.ts`: `webTool` (hold logic, `repeatHeld` set, 80 and 60 thresholds), the `research_query` tool.

### Worked example

Query one: "python dataclass default mutable list". Terms: python, dataclass, default, mutable and list (each has 4 or more characters). The set is {dataclass, default, list, mutable, python}.

Query two: "dataclass mutable default list python fix". "fix" is under 4 characters and is dropped. The sets are identical, so the score is 100% and the search is held once.

Query three: "python dataclass field factory". Shares python and dataclass with query one: 2 shared of 7 total terms, about 29%. Nothing happens.

Query four: "python dataclass default mutable". 4 shared of 5 total: 80%, so it is held.

(The numbers here are worked from the rule above, not captured from a run.)

### Reading the message

The REPEAT line gives the percentage, the date of the earlier query, and the earlier query text. When held, Claude is pointed at two ways to look in memory: the `search` tool with `kinds: ["research"]`, or `research_map`. Claude should read what is saved, and only run a fresh search if it is missing something. Because the second identical call always runs, the hold costs one round trip at most.
