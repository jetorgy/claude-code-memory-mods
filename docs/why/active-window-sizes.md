# Why the active window is 20 exchanges (range 6 to 40, 40,000 characters)

One line: after a compaction, the last 20 whole question-and-answer pairs are shown again in full; the number tunes itself between 6 and 40 and never exceeds 40,000 characters.

Related: [../session-memory/active-window-and-compaction.md](../session-memory/active-window-and-compaction.md), [../session-memory/handoff.md](../session-memory/handoff.md), [../reference/configuration.md](../reference/configuration.md), [auto-compact-150k.md](auto-compact-150k.md)

## The choice (from `mods/session-memory/engine/window.mjs`)

- `START_PAIRS = 20`, `MIN_PAIRS = 6`, `MAX_PAIRS = 40`.
- `BUDGET_CHARS = 40000` (the code comment says about 10,000 tokens). A hard ceiling.
- Shown only on the first message after a compaction.
- Pairs are whole: if they exceed the budget, the oldest whole pairs are dropped; text is never clipped mid-message.
- Pairs that are only talk of switching the memory on or off are left out.

Other numbers that sound similar but are different settings:
- Per-message recall cap: 10 items (`TURN_ITEMS`). See [recall-limits.md](recall-limits.md).
- New-session handoff: `handoffMessages = 10` most recent messages from earlier sessions, up to `handoffMaxChars = 4200` (`engine/store.mjs`). That is for starting a new session, not for the window.

Old documents (`docs/HOW-IT-WORKS.md`) say the window starts at 40 and ranges 10 to 80. That was an earlier value; the code now says 20 and 6 to 40.

## The problem it solves

After a compaction Claude has only a summary. A summary loses the exact wording of the last few exchanges, which is what the next message is usually about ("do that again but smaller"). Re-showing the last exchanges verbatim fixes that without keeping the entire conversation.

## Why a window at all, and why only after a compaction

Before a compaction, the live conversation already is the window; adding a copy would just duplicate text. Only after the conversation has been replaced by a summary is there something missing to restore.

## Why these values

Evidence level: from the owner's own session history, plus the code.

History shows three stages:
1. The window was first 10 pairs, range 2 to 20, budget 40,000 characters.
2. The owner said that with a 150k compaction limit the window could hold more, suggested 40 to 80, and the code was changed to start at 40 and tune between 10 and 80.
3. A later session: the owner noticed compactions only brought usage from about 75% to 65%, "which isnt a lot", and asked for tighter compaction. The numbers were then lowered to the present 20 and 6 to 40, and the summary instructions were limited to 400 words. (Compaction was tightened "in two places", per the assistant's reply; the two places are inferred here to be the window and the summary instructions, since both appear in the code that way, but the reply text was not re-read.)

So the owner's reasoning was: a bigger window fits a bigger compaction limit, but a window that is too big eats the room the compaction was meant to free. 20 is the compromise they landed on after seeing real numbers.

The 40,000 character cap (about 10,000 tokens, per the code comment) is the hard ceiling so a few huge exchanges cannot refill the room. Why exactly 40,000 is not recorded beyond the comment "tightened so a compaction frees more room". Inference, not verified: 10,000 tokens is roughly 7% of a 150,000-token trigger, a small share.

## How it tunes itself

On each compaction the code compares how many turns passed since the previous one against the average of the last three intervals:
- Much faster (under 75% of average): lose 2 pairs, down to 6. The window is eating room.
- Much slower (over 133% of average): gain 1 pair, up to 40. There is room to spare.
- Otherwise: unchanged.

Why asymmetric (shrink by 2, grow by 1)? The comment says it follows how the author tuned the upstream Liminal memory library; the underlying idea is that being too big is a worse failure than being too small, so it backs off fast and grows slowly. That reasoning is an inference, not verified. The state lives in `~/.claude/session-memory/window-state.json`.

## What the window also does for recall

After a compaction, the exchanges older than the window's first pair are no longer in front of Claude. The mod writes `window-cut.json` so recall may bring back this session's older memories, which it normally skips because they are already visible. See [recall-limits.md](recall-limits.md).

## Alternatives and trade-offs

- A fixed small window (say 10): cheaper, but the loss of recent context is felt more.
- A fixed large window (40 or more): better continuity, but a compaction frees less room.
- Clip long messages to fit more pairs: rejected in the code (whole pairs only), because a half-message can mislead.
- Trade-off of self-tuning: it adapts to how you work, but its behaviour is harder to predict than a fixed number.

## How to change it

Edit the constants at the top of `window.mjs` in `~/.claude/my-mods/session-memory/engine/`. There is no config file entry for these. To reset the learned value, delete `~/.claude/session-memory/window-state.json`. `node window.mjs --status` prints the current state.
