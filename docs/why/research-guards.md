# Why research has repeat checks and bridge thresholds

One line: web searches are checked against earlier ones so you do not pay twice for the same question, and saved research is cross-linked by meaning with strict cutoffs.

Related: [../session-memory/research.md](../research/workflow.md), [../reference/configuration.md](../reference/configuration.md), [recall-limits.md](recall-limits.md), [private-local-ollama.md](private-local-ollama.md)

## The choice (from the session-memory research tools)

- Repeat check: compares the new query to earlier ones by Jaccard word overlap (shared words divided by all distinct words).
  - 0.6 or more: reports `REPEAT`.
  - 80% or more: the web search is denied once; sending the same query again runs it.
  - 60 to 79%: the search runs, with a RESEARCH NOTE added pointing to the earlier one.
- Semantic bridges between research notes: cosine 0.85 or more, only between different categories and different sources, top 12.
- The "aha" line (a surprising link): cosine 0.65 or more, up to 4 categories.
- Research paragraph nodes are 200 to 1,400 characters each.
- Research nodes never go cold (see [strength-constants.md](strength-constants.md)).
- The optional panel (Estimator and Skeptic) uses one shared model.

## The problem it solves

- Repeated searches cost time and money, and Claude often repeats a search it already made earlier or in another session. The check says so and points to the saved answer.
- Research gets scattered across topics. Bridges find shared ideas across different sources, which is the useful part of research that a keyword search would miss.

## Why a two-stage repeat check (note, then block)

Overlap measures words, not meaning, so it can be wrong. A hard block on every match would stop legitimate new searches that happen to share words. So:
- At 60 to 79% the mod only informs. The search still runs.
- At 80% or more it denies once. If the repeat was wrong, one re-send gets through. The block is a speed bump, not a wall.

## Why Jaccard word overlap

It is simple, fast, needs no model and no network, and is easy to inspect. Its weakness: two phrasings of the same question with different words will not match. The mod accepts that, using the semantic side only for bridges. Inference, not verified: the reason for word overlap is simplicity; no comparison against embedding similarity is recorded.

## Why 0.85 for bridges and 0.65 for the aha line

- Bridges are saved links and appear in results, so they need high confidence: 0.85. Per the code comment on recall, unrelated text under nomic reaches roughly 0.65, so 0.85 is clearly above noise.
- The "aha" line is a one-off suggestion that costs little if wrong, so it uses 0.65, the noise ceiling, but also needs up to 4 distinct categories to count.
- Why "different categories and different sources": two notes from the same page are naturally similar; the interesting links are across them.

The numbers are from the code. No history was found explaining the exact values: evidence level is "from the code", reasons are inference, not verified.

## Why 200 to 1,400 characters per node

A paragraph is about the size where one idea fits. Smaller nodes lose context; bigger nodes blur several ideas and weaken the embedding. The range is from the code; the explanation is inference, not verified.

## Why research never goes cold

Normal memories fade because most conversation is transient. Saved research is something the owner chose to keep, so it stays at full availability.

## The panel and its limit

The optional Estimator and Skeptic roles argue with each other to catch weak claims. They share one underlying model, so their mistakes are correlated: if the model is confidently wrong, both may agree. The panel is a prompt for second looks, not an independent verification. This is stated here because it limits how far to trust it.

## Evidence level

From the code for every number on this page. From the owner's own session history: nothing found. Reasons given are inference, not verified.

## Alternatives and trade-offs

- No repeat check: simple, but repeated cost.
- Embedding-based repeat check: catches paraphrases, needs the local model every search.
- Hard block always: stops waste, frustrates legitimate re-searches.
- Lower bridge threshold: more links, more false ones.

## How to change it

Edit the thresholds near the top of the research module in `mods/session-memory/engine/` (look for the constants named in this page), then `/reload-plugins`. There are config entries for none of these.
