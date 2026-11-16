# Handoff

When a brand-new session starts, the mod gives Claude a short briefing of what happened in earlier sessions: the last messages, unsolved errors, saved lessons and the commands to use.

Related: [reading-sessions.md](reading-sessions.md), [recall.md](recall.md), [tool-call-memory.md](tool-call-memory.md), [strength-and-crystallization.md](strength-and-crystallization.md), [../research/research-pool.md](../research/research-pool.md), [../reference/configuration.md](../reference/configuration.md), [../reference/files-on-disk.md](../reference/files-on-disk.md), [../extras/flight-recorder.md](../extras/flight-recorder.md)

## What it does

On the first prompt of a new session, the mod adds a block of up to about 4,200 characters to Claude's context. It is called the handoff. It says, in order:

1. The most recent messages from earlier sessions, oldest first.
2. Errors that keep happening and have not been solved.
3. Lessons saved earlier.
4. Lessons from times you said an answer was wrong (last 30 days).
5. The memories used most often lately.
6. A line listing the memory commands Claude can use.

A resumed session gets no handoff, because it already has its own history.

## Why it exists

A new session starts empty. Without the handoff, Claude does not know what you were doing an hour ago, which command failed three times yesterday, or that you told it never to do something. You would have to repeat it, or hope the prompt happens to match a memory.

The handoff is cheap insurance: it costs a few hundred tokens once per session, and it is built from facts already saved, not from a model summary.

## How it works

Plain version:

- On the first prompt, the mod checks whether it has seen this session before. A session is "known" if memory already has a node for it, or the recall log already has a handoff entry for it. If it is known (for example after `--resume`), nothing is added.
- Before building the handoff, the mod reads the newest lines of the previous session so the very last exchange is included. If another reader is already working, this step is skipped and the handoff uses what is saved.
- The block is built section by section and trimmed to fit the character budget. Lines are removed from the end of a section until it fits. If even the first line of a section does not fit, the whole section is left out.
- The memory commands line is always last and always kept; 260 characters are reserved for it.
- The handoff searches both active memory and cold storage, so old but still useful notes can come back.
- A very short first prompt (under 12 characters, like "hi") searches nothing but still gets the handoff.

What each section shows:

| Section | Content | Limit |
|---|---|---|
| Most recent messages from earlier sessions (oldest first) | Your request clipped to 80 characters, Claude's answer clipped to 70. Requests and corrections from other sessions only, no helper agents, no switch-talk | 10 messages |
| Errors that keep happening and are not solved yet | Failures seen more than once, not fixed since last seen, no lesson attached, not a harness error | 3 |
| Lessons saved earlier | Each clipped to 160 characters, ending with `(ref xxxxxxxx)` | 4 |
| Recent lessons (the user said an answer was wrong) | Corrections from the last 30 days | 2 |
| Memories used most often lately | Strongest recently recalled nodes | 2 |
| Memory commands | One line naming `search`, `mark`, `correct_memory`, `investigate_error` and `/recall` | always |

The ref in a lesson line is the first 8 hex characters of the SHA-1 of the node id. Claude can pass it to `correct_memory` to fix or forget that lesson (see [lessons-and-corrections.md](lessons-and-corrections.md)).

The ordinary recall block ends with: `Something here wrong or outdated? Fix it now with correct_memory (give the ref).`

## Limits and settings

| Setting | Default | Meaning |
|---|---|---|
| `handoffMessages` | 10 | how many earlier messages to list |
| `handoffMaxChars` | 4200 | total size of the block |
| `maxResults` (recall) | 5 | ordinary recall hits |
| `maxChars` (recall) | 2400 | ordinary recall size |
| `minScore` (recall) | 0.7 | how close a memory must be to be shown |

These are in the recall config (see [../reference/configuration.md](../reference/configuration.md)). The handoff is skipped entirely when the memory is off.

## How to see it working

Start a fresh session and look at the first prompt's context. The block looks like this (shortened):

```
Most recent messages from earlier sessions (oldest first):
- User: fix the window tuning ... | Claude: Changed MIN to 6 ...
Errors that keep happening and are not solved yet:
- Write failed 3 times: File has not been read yet ...
Lessons saved earlier:
- [project] When Write is refused, Read the file first ... (ref 3fa9c1d2)
Memory commands: search, mark, correct_memory, investigate_error, /recall
```

From the shell you can print the same thing without starting a session:

```
node mods/session-memory/engine/recall.mjs --handoff --session SOME-NEW-ID
```

The recall log records each handoff as an entry with `handoff: true`:

```
$ grep '"handoff":true' ~/.claude/session-memory/recalls.jsonl | tail -n 1
```

`/recall stats` shows the memory counts the handoff is drawn from.

## Known limits

- Only 10 earlier messages, clipped to 80 and 70 characters. It is a pointer, not a transcript. Use `search` or `session_trail` for detail.
- Messages come from all projects, not only the current folder. Lessons prefer the current project but are not limited to it.
- The "errors that keep happening" section only lists failures with more than one occurrence and no lesson. A failure that happened once is not shown.
- If the previous session ended abruptly, its last lines may not be indexed yet; the pre-read can miss them when another reader holds the lock.
- Because a resumed session gets no handoff, resuming after a very long break gives no refresher beyond normal recall.
- Switch-talk (asking to turn memory on or off) is filtered from the message list.

## Details

- `engine/recall.mjs`
  - `handoff()` builds the sections and applies the budget. `render()` turns the sections into text and trims line by line.
  - `--handoff` entry point: it decides "session not yet known" by checking for a node `s:<session>` in memory and a `handoff:true` row in `RECALLS_PATH` for the session.
  - Before building, calls `indexAll()` to read the previous session's newest lines; skipped if the lock is held.
  - Config keys `handoffMessages` (10) and `handoffMaxChars` (4200); recall defaults `maxResults` 5, `maxChars` 2400, `minScore` 0.7.
  - Lessons: `all('lesson')` filtered by `forgotten()` and `isSwitchTalk`, sorted with current-project lessons first, then by `strengthOf`. Text comes from `fixedText(l.id) ?? body(l)`, clipped to 160 chars.
  - Reserved tail: 260 characters for the commands line.
- `engine/store.mjs`: `refOf(id)` returns the first 8 hex characters of `sha1(id)`; `isSwitchTalk` filters messages.
- `engine/strength.mjs`: `strengthOf` ranks lessons and "most used" memories (see [strength-and-crystallization.md](strength-and-crystallization.md)).
- `hooks/register.ts`: the prompt handler calls `recall.mjs` with `--handoff` on the first prompt of a session, and with `--q` afterwards; prompts under 12 characters search nothing.
- Files: `~/.claude/session-memory/recalls.jsonl`, `memory.json`, `cold.json.gz` (see [../reference/files-on-disk.md](../reference/files-on-disk.md)).
