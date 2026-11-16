# Why the mods are set up this way

One line: an index of short pages that explain, for each important choice, the problem it solves, why that value, what else was possible and how to change it.

Related: [../session-memory/overview.md](../reference/architecture.md), [../reference/configuration.md](../reference/configuration.md)

## How to read these pages

Every page has the same sections: The choice, The problem it solves, Why this value, Alternatives and trade-offs, How to change it, and Evidence level. The evidence level tells you how far to trust the "why":

| Level | Meaning |
|---|---|
| from the code | the value or behaviour is in the source; I read it |
| from the owner's own session history | the owner said or did it in a recorded session |
| inference, not verified | a plausible reason, never written down or measured |

No reason is invented to fill a gap. If a page says "not recorded", it means exactly that.

## Pages

| Page | The question it answers |
|---|---|
| [auto-compact-150k.md](auto-compact-150k.md) | Why compact at 150,000 tokens, and why save to memory first? |
| [active-window-sizes.md](active-window-sizes.md) | Why 20 exchanges (6 to 40, 40,000 characters) are re-shown after a compaction? |
| [strength-constants.md](strength-constants.md) | Why memories gain and lose strength with these numbers? |
| [recall-limits.md](recall-limits.md) | Why recall is capped at these counts and score floors? |
| [private-local-ollama.md](private-local-ollama.md) | Why a private Ollama on port 11435 with gemma4:e4b? |
| [off-switch-user-only.md](off-switch-user-only.md) | Why only you can turn the memory off? |
| [research-guards.md](research-guards.md) | Why repeat checks and bridge thresholds for research? |
| [read-only-and-install-safety.md](read-only-and-install-safety.md) | Why read-only, local and cautious installs? |
| [model-routing.md](model-routing.md) | Why prompts and helpers go to cheaper models? |
| [vibe-coded-and-limits.md](vibe-coded-and-limits.md) | How were these made, and what is unproven? |

## The short version

- Cost and focus: compaction at 150,000 and a modest window keep conversations small; routing keeps simple work on cheap models.
- Nothing is lost: the whole conversation is saved before it is summarised, and memories fade rather than being deleted.
- Private by default: one local address, read-only access, restricted folder, excluded projects.
- User in control: only you flip the switch; installs ask before changing or downloading anything.
- Honest about limits: most numbers are working choices from one owner's use, not benchmarked results.

## Common ways values interact

- Compaction trigger and window size work together. A bigger window frees less room per compaction.
- Recall caps and the window both limit what is injected after a compaction.
- Strength feeds recall ranking, so changing strength constants changes what surfaces.
- The local model feeds embeddings (recall), grading (routing) and summaries; with it off, those fall back to keyword search and Haiku.

## Where the numbers live

Constants are at the top of the relevant source file (named on each page). Adjustable settings are in the config file; see [../reference/configuration.md](../reference/configuration.md). After editing code constants, reload the plugins.

## Reading order

1. Start with [vibe-coded-and-limits.md](vibe-coded-and-limits.md) to know what kind of evidence to expect.
2. Then [auto-compact-150k.md](auto-compact-150k.md) and [active-window-sizes.md](active-window-sizes.md), which most affect daily use.
3. Then recall and strength, which decide what Claude is reminded of.
4. The remaining pages cover privacy, safety, the local model and routing.

## Keeping these pages true

When a constant in the code changes, edit the matching page the same day and re-state its evidence level. If the owner gives a reason in a session, record it under "from the owner's own session history". If a page and the code disagree, the code is right.
