# Research workflow

A switchable research mode that makes Claude plan, collect, appraise and write up a question in six gated stages, with every step saved as files on disk.

Related: [research-pool.md](research-pool.md), [repeat-block.md](repeat-block.md), [research-map.md](research-map.md), [aha-line.md](aha-line.md), [../session-memory/recall.md](../session-memory/recall.md), [../reference/files-on-disk.md](../reference/files-on-disk.md), [../reference/configuration.md](../reference/configuration.md)

## What it does

When research mode is on, Claude stops treating a research question as "run a search and summarise". Instead it works the way a researcher would:

1. It opens a project folder named after the question, `research/<slug>/`, in the directory you are working in.
2. It writes down the question and a search plan (including when to stop) before it looks anything up.
3. It collects sources, logging every query and every kept source.
4. It judges how far each source and each answer can be trusted.
5. It records what it did and what it learned in a notebook, and loops back if the stopping rule is not met.
6. It writes a report with a certainty level for every answer, and a list of claims that the mod checks mechanically against the saved evidence.

Two simulated experts are used along the way: an **Estimator** who guesses the answer before sources are read, and a **Skeptic** who attacks the plan and the draft conclusion. Both are run as subagents. They are the same underlying model, so when they agree, that is not proof of anything. You are the tiebreaker, and the workflow tells Claude to put open disagreements to you at every gate.

## Why it exists

A plain web search produces a confident summary of whatever the first few results said. Three things go wrong: the plan is bent after the fact to fit what was found, summaries are mistaken for the sources themselves, and certainty is stated higher than the evidence supports. The workflow forces the plan to be committed first, forces at least half the kept sources to be read in full, and forces the report to say what was not searched. Everything lands in files you can open, so the work can be audited rather than trusted.

## How it works

### Switching it on and off

* Type `/research on`, `/research off` or `/research status`.
* Or say it in plain words in a short message (under 300 characters), for example "turn research mode on" or "switch research mode off". The phrase patterns are in `ON` and `OFF` in `mods/research/hooks/register.ts`.
* The switch is a small file, `research-mod-state.json` in the Claude home folder, so it survives restarts. Turning it off leaves the `research/` folders in place.
* While on, the status line shows `research: <stage>` (or `research: no project`).

### What Claude sees while it is on

On every message you send, a note is added to the prompt: the seven working rules, plus where the active project stands. If there is no project yet, the note tells Claude to call `research_start` with your question before searching anything.

### The files

Each project is a folder `research/<slug>/` under the current working directory. The slug is the question lowercased, non-letters turned into hyphens, cut to 48 characters.

| File | What goes in it | Written by |
|---|---|---|
| `state.json` | slug, current stage, the question, creation date | the mod |
| `question.md` | the question, why it matters, the decision it feeds, scope | Claude |
| `protocol.md` | sub-questions, sources, search terms, exclusion rules, stopping rule, dated amendments | Claude |
| `queries.md` | every search, with date, tool, terms, result (including empty) | Claude via `research_log` |
| `evidence.md` | one line per source: `E<n> | title url | type | READ: full or READ: summary | SQ | quote`, plus appraisal | Claude via `research_log` |
| `notebook.md` | dated entries: hypothesis, action, result, interpretation, next step | Claude via `research_log` |
| `report.md` | the final answer with certainty levels and a `## Claims` section | Claude |

### The six stages and their gates

A gate is a check the mod runs when Claude asks to leave a stage with `research_stage`. If the check fails, the move is refused and Claude is told what to fix.

| Stage | Claude is told to | Gate to leave |
|---|---|---|
| 1. Clarify | Write `question.md`, ask you about anything that changes the plan, run the Estimator on the bare question and log its prior | `question.md` must mention "decision" and "scope" |
| 2. Protocol | Write `protocol.md` before collecting, with sub-questions, exclusion rules and a "Stopping rule" section; run the Skeptic on it; show you; later changes go in a dated "Amendments" section | `protocol.md` must mention "stopping rule", "sub-question" and "exclu..." |
| 3. Search and collect | Follow the protocol, log every query, open each kept source in full, save it as an `E<n>` line | at least half of the `E<n>` lines (ignoring lines marked RETRACT) must say `READ: full` |
| 4. Appraise | Judge each source's credibility and each sub-question's certainty (high, moderate, low, very low), triangulate | none |
| 5. Iterate | Write a notebook entry; compare with the stopping rule; if not met, sharpen the question, amend the protocol openly and return to collect | none |
| 6. Stop and synthesize | Run the Skeptic on the draft; write `report.md` with answer per sub-question, certainty, disagreements, what was not searched, open questions; add `## Claims` lines | `report.md` must mention "certaint..." and one of "not searched", "cut" or "limitations" |

The gates are keyword checks, not judgements of quality. They stop a skipped section; they do not stop a thin one.

Moving backwards (for example appraise back to collect) is allowed and is not gated. Only moves forward past a stage with a gate are checked. Jumping ahead is allowed but only the gate of the stage you are leaving is checked: asking for `synthesize` from `clarify` checks the clarify gate and skips the protocol and collect checks (read from `advance` in the code).

### The claim ledger (final check)

When Claude calls `research_stage` after the last stage, there is no next stage, so the mod runs the claim ledger instead. Each line in `report.md` under `## Claims` must look like

`C1: the claim | E3,E5 | "a span of at least four words copied from that evidence entry"`

The mod checks, with plain string matching and no model: the evidence ids exist in `evidence.md`, the span has at least four words, and the span appears (ignoring case and punctuation) in one of the cited entries. Failures are listed per claim; passing prints a confirmation. It proves a quote exists in your notes. It does not prove the quote supports the claim.

### The panel

The Estimator gets only the question. The Skeptic gets the protocol or the draft conclusion. Both run as subagents; the wording in `PANEL` says they share one model, so their errors are correlated. Their answers and rationales are to be recorded in the notebook.

## Limits and settings

* On/off switch: `/research on|off|status`, or a phrase. No other setting.
* The reminder interval is `REMIND_EVERY = 12`: every 12th non-search tool call while a project is active, Claude gets a reminder of the current stage's instructions (first 260 characters).
* A search (`WebSearch` or `WebFetch`) during clarify or protocol triggers a warning that the protocol is meant to be committed first.
* Searches in later stages get a reminder to open the best 2 to 4 results in full, tag evidence as read in full or summary only, and check the stopping rule.
* Project slug is capped at 48 characters; a second question with the same slug reuses the same folder name (the state file is rewritten).
* Only one project is active at a time (`research-mod-state.json` holds one slug).

## How to see it working

* `/research status` prints `Research mode ON. Project <slug>, stage <stage>, workspace research/<slug>/`.
* Open `research/<slug>/state.json` to see the stage, and `notebook.md` to see logged entries.
* Try to leave `collect` with no `READ: full` entries: `research_stage` answers "Gate not passed: only 0 of N evidence entries...".
* The flight recorder does not log research-mode events (see [../extras/flight-recorder.md](../extras/flight-recorder.md)).

## Known limits

* Gates check for words, so a one-line `protocol.md` containing the right words passes.
* The two experts are one model; the workflow says so but cannot make them independent.
* The "read in full" label is the model's own claim. The mod counts the label, not the text that was actually read.
* WebFetch returns a digest, not the page; the reminder says to tag those "READ: summary".
* The workspace is relative to the working directory, so starting Claude in a different folder starts a different `research/`.

## Details

* `mods/research/hooks/register.ts`
  * `STAGES`, `PANEL`, `RULES`: the stage text, gates (`gate.file`, `gate.needs` regexes) and rules.
  * `isOn` / `setOn`: read and write `<CLAUDE_HOME>/research-mod-state.json` (`CLAUDE_HOME` env or `~/.claude`); shape `{on, slug}`.
  * `advance`: the `research_stage` tool. Order of checks: no project -> error; no next stage -> `verifyLedger`; leaving `collect` forward -> half-READ-full rule (applies only if at least one `E<n> |` line exists); leaving any stage with a gate forward -> regex gate; otherwise `enter`.
  * `verifyLedger`: normalises text to lowercase letters, digits, `%` and single spaces; spans need 4 or more words.
  * Tools registered at `session.start`: `research_start`, `research_log` (`file` is `notebook`, `queries` or `evidence`), `research_stage` (`to` optional). Hooks are matched as `mcp__research__<name>`.
  * `research_log` appends `## <date>` plus the text to the file, then also ingests the text into the research pool with `--topic <slug> --source "<file>.md <date>"` (20 s timeout, best effort). See [research-pool.md](research-pool.md).
  * `research_start` refuses with "Research mode is off. Do not start a project." when the switch is off.
  * `command.run` handles `/research`; `prompt.submit` handles phrase switching and injects the rules note; the final `tool.call` wrapper adds the search nudges and the every-12-calls reminder, skipping the mod's own tools.
* Plugin manifest: `mods/research/.claude-plugin/plugin.json`, version 0.1.0.
