# Why auto-compaction fires at 150,000 tokens

One line: the mod compacts a long conversation itself at 150,000 tokens, after saving it to memory, so the summary can be short and nothing is lost.

Related: [../session-memory/active-window-and-compaction.md](../session-memory/active-window-and-compaction.md), [../session-memory/handoff.md](../session-memory/handoff.md), [../reference/configuration.md](../reference/configuration.md), [active-window-sizes.md](active-window-sizes.md), [off-switch-user-only.md](off-switch-user-only.md)

## The choice

- `COMPACT_AT = 150000` in `mods/session-memory/hooks/register.ts`. When a turn finishes and the conversation is at or above 150,000 tokens, the mod starts a compaction.
- `COMPACT_COOLDOWN_MS` is 5 minutes: it will not start another one within 5 minutes of the last.
- Only the main conversation counts (not helper agents), and not a turn the user aborted.
- The installer with `--autocompact` also writes `autoCompactWindow: 150000` into Claude Code's `settings.json` (`install/install.mjs`). It does this only if you have not already set that key.
- The summary is told to stay under 400 words and 2,500 characters.

## What compaction is

Claude has no memory between messages. Every time you send one, the whole conversation so far is sent again. Compaction replaces the older part of the conversation with a short written summary, so the conversation shrinks. Anything the summary leaves out is gone from Claude's view.

## The problem it solves

1. Long conversations cost more. Each turn re-sends everything. (Caching makes repeated text cheaper but not free, and it is not guaranteed.)
2. Long conversations tend to work worse. Details buried deep in a huge conversation are easier to miss. This is a general property of language models, not something this repo measured.
3. Claude Code can compact on its own, but by default it waits until the window is nearly full. On a very large window that is a very long wait.

## Why saving to memory FIRST makes a short summary safe

The usual risk of compaction is that the summary drops a detail you later need. Here, the mod hooks every compaction (`session.compact`, whoever starts it: you, Claude Code, or the mod). Before the summary is written it runs the indexer (`engine/index.mjs`) so the whole conversation is stored in the searchable memory. Then it adds instructions telling the summarizer the conversation is saved and can be recalled, so keep the summary to goals, decisions, exact paths and settings, open problems and the user's preferences, and drop exploratory output and resolved dead ends.

After the compaction, the next message carries a note saying so, and naming how to search memory (`mcp__session-memory__search`, `session_trail`) before asking you to repeat anything. The short summary is therefore safe only because a full copy exists elsewhere. If the save fails, the hook falls through to a plain compaction rather than blocking it.

## Why the recent exchanges are re-shown afterwards

A summary is good at "where we are" and bad at the exact last few things said. So on the first message after a compaction the mod re-attaches the last whole user/Claude exchanges word for word (see [active-window-sizes.md](active-window-sizes.md)). That is also why the summary instructions say "the last exchanges are re-shown in full, do not repeat them": it avoids paying twice for the same text.

## Why 150,000

Evidence level: from the owner's own session history, plus inference.

From history: the hook was added after a conversation reached 332,173 tokens, 33% of a 1,000,000-token context, and the owner's earlier attempt at compacting had failed without any error message. A later session recorded the owner's remark that, with a 150k compaction limit, the active window could be larger. In a later session the owner also complained that a compaction only took usage from about 75% to 65% of the limit, which led to tightening the summary and the window (see the other why docs).

From the code: 150,000 is a plain constant with no derivation written down anywhere. Why that exact figure rather than 100,000 or 200,000 is not recorded. Inference, not verified: it is a round number well below the 1M window and low enough to keep per-turn cost and drift down, but high enough that compactions are not constant. The owner has not measured the cost or quality effect (see [vibe-coded-and-limits.md](vibe-coded-and-limits.md)).

## Why a hook AND Claude Code's own setting

The mod's hook is the primary mechanism, because only the hook saves to memory first and tells the summarizer to be short. Claude Code's own `autoCompactWindow` setting is a safety net: if the hook is off (`/memory-off` stops it), not loaded, or fails, the host still compacts at the same size. Without the setting, a broken hook would mean silent growth again, which is the failure that happened at 332,173 tokens. `--autocompact` is opt-in because it edits your settings file; the installer backs the file up first.

Note the setting alone gives a plain compaction with no save-first step, but the mod's `session.compact` hook still runs on it if the mod is loaded.

## Why it must use `$.command.run({command:'compact'})` (desktop app caveat)

The code first tries a direct `$.session.compact(...)` call. In the Claude desktop app (and SDK sessions) that call is refused. Submitting `/compact` as a prompt is also refused ("a prompt starting with / is refused" per the code comment). What works is `$.command.run({ command: 'compact' })`, run from the turn-complete hook. This is recorded as a lesson in the owner's memory, "verified 2026-11-15": it compacted, and the owner watched it happen. The earlier silent failure was the direct call failing without anyone seeing; the code now logs every attempt (`compact_try` events in the flight recorder) so a failure is visible.

Because the command path goes through the host, the mod's own `session.compact` hook runs and does the save-first step.

## Alternatives and trade-offs

- Never compact automatically: simplest, but conversations grow past the point of usefulness.
- Compact later (200k or more): fewer interruptions and fewer lost details, higher cost per turn.
- Compact earlier (100k): cheaper and cleaner, but the summary is made more often and the conversation is reshaped more often.
- Rely only on Claude Code's setting: no save-first step, so the summary has to be long to be safe.
- Trade-off of the chosen approach: a compaction takes time and one model call, and it changes what Claude can see mid-task. The cooldown stops back-to-back compactions.

## How to change it

- The hook value: edit `COMPACT_AT` in `mods/session-memory/hooks/register.ts` in your installed copy under `~/.claude/my-mods/session-memory/`, then `/reload-plugins`. Keep the checksum file in mind if you verify against it.
- Claude Code's setting: edit `autoCompactWindow` in `~/.claude/settings.json`.
- Summary length: edit `COMPACT_INSTRUCTIONS` in the same file.
- Turn everything off: `/memory-off` (the hook stops; Claude Code's own setting still applies).
