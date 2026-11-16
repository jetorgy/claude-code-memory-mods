# Why these docs say "not verified": how the mods were made, and what is unproven

One line: the mods were built in conversation with Claude by one owner on one machine, with little formal measurement, so most numbers are working choices rather than tested optima.

Related: [../session-memory/overview.md](../reference/architecture.md), [../reference/configuration.md](../reference/configuration.md), [read-only-and-install-safety.md](read-only-and-install-safety.md), [index.md](index.md)

## The choice

Be explicit about the status of every setting instead of presenting them as engineered facts. Each page in this folder ends with an evidence level:
- from the code: the value is in the source and I read it.
- from the owner's own session history: the owner said or did something recorded in their saved sessions.
- inference, not verified: a plausible reason that nobody wrote down or measured.

## The problem it solves

Documentation tends to make every number sound deliberate. A reader would then assume 150,000 or 0.7 was tuned against data. For most values here that is not true, and a reader who changes them should know they are not breaking a carefully balanced system, and also that they have no benchmark to compare against.

## How the mods were made

Evidence level: from the owner's own session history.

They were built iteratively with Claude Code: a problem showed up in real use, a change was made, the owner watched whether it worked. Examples recorded in history:
- The compaction hook was added after a real conversation reached 332,173 tokens (33% of a 1M window). A first attempt failed silently, which is why every compaction attempt is now logged.
- In the desktop app, the direct compaction call is refused; the working route was found and checked by the owner watching a compaction run.
- The active window began at 40 pairs, then was cut to 20 after the owner saw compaction only moving usage from about 75% to 65%.
- A separate private Ollama was set up because the existing one is a Docker container without GPU that must keep running.

This is working, tested-by-use software, not a validated system.

## What is verified

- The code reads as documented for the values on these pages (I checked constants against source).
- Several behaviours were observed to work by the owner in their own sessions (compaction via the command route).
- The installer has a dry run, backup and uninstall.

## What is not verified

- Whether 150,000, a window of 20, the recall caps, the score floors or the strength constants give better results than other values. No benchmark or A/B test is recorded.
- Retrieval quality: how often recall surfaces the right memory, or a wrong one.
- Cost savings from model routing.
- Any platform other than Linux Mint 22.3 with bash, Node 24 and an NVIDIA GPU.
- Security against a determined attacker; guards are meant to stop accidents and simple prompt injection.
- Long-term behaviour of the learned values (window size, strength) over months.

## Known doc/code disagreements found while writing these pages

- `docs/HOW-IT-WORKS.md` says the window starts at 40 and tunes between 10 and 80; the code has 20 and 6 to 40 with a 40,000 character cap.
- A comment in `model-selector/hooks/register.ts` says the local model stays loaded 30 minutes; the code is 3 minutes.
- The old docs read as if model routing happens on every message; in auto mode it happens once and only effort follows.
- Notes mention `gemma4:12b` being used earlier; the code uses `gemma4:e4b`.
- The strength constants (+0.15, 7 day half-life, 20 reuses) do agree with the old doc.

## Why admit all this

Trust. A setting described honestly as a guess is easier to change safely than one dressed as science. It also tells future work where measurement would help most: recall precision, window size against compaction savings, and the grader's accuracy.

## Alternatives and trade-offs

- Present all values as designed: shorter and more confident, but misleading.
- Delay release until measured: more rigorous, but nothing is shared.
- Trade-off of the honest approach: readers may trust the project less at first glance, in exchange for being able to trust what it does claim.

## How to improve it

- Add measurement (for example, log which recalled items Claude actually used) and update these pages with real numbers.
- If you test another platform, record it.
- When a value changes, update the matching page and its evidence level.
