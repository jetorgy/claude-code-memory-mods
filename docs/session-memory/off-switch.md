# Off switch

A user-only switch that turns the whole memory mod off and on, and that Claude and other mods cannot flip.

Related: [reading-sessions.md](reading-sessions.md), [recall.md](recall.md), [tool-call-memory.md](tool-call-memory.md), [strength-and-crystallization.md](strength-and-crystallization.md), [../research/research-pool.md](../research/research-pool.md), [../reference/configuration.md](../reference/configuration.md), [../reference/files-on-disk.md](../reference/files-on-disk.md), [../extras/flight-recorder.md](../extras/flight-recorder.md)

## What it does

Type `/memory-off` and the mod stops: no recall, no notes added to prompts, no window, no saving of new memory, no automatic compaction. Type `/memory-on` and it starts again, with a background re-index to catch up.

Memory already saved is not touched either way.

## Why it exists

Sometimes you want a clean session: a private conversation, a test where old memory would bias the result, or a suspected bad memory you want out of the way while you debug. The switch must be reliable, and it must belong to you. If Claude could turn memory off (or back on) by itself, or another mod could, the switch would mean nothing.

## How it works

Plain version:

- The switch is a file: `~/.claude/session-memory/disabled`. If the file exists, the mod is off.
- `/memory-off` creates the file. `/memory-on` removes it and starts an index in the background.
- The mod reads the file once and keeps the answer in memory. The two commands update that answer, so there is no per-prompt disk check.
- If a command arrives from another mod, it is refused. Only you, typing the command, can use it.
- Claude cannot work around it with tools either. A guard runs before every tool call, even while the mod is off, and refuses:
  - calling the memory switch as a skill or slash command,
  - a shell command that touches the flag file (touch, rm, mv, cp, ln, tee, truncate, install, dd, or a `>` redirect),
  - a Write, Edit or NotebookEdit to a path ending in `session-memory/disabled`.
  Each refusal is returned to Claude as `NOT_YOURS`.
- Talk about the switch is kept out of memory. Text such as "turn memory off" is detected and left out of recall, handoff, the window, trails and search results, so the instruction does not get saved and replayed to a later session.

While off:

- no recall block on prompts,
- no notes about tool calls,
- no window and no handoff,
- no saving of new exchanges,
- no automatic compaction.

The tools (`search`, `mark` and so on) also do nothing useful, because the engine is switched off.

## Example

A typical use, step by step:

1. You type `/memory-off` before a private conversation.
2. The flag file appears. Prompts carry no recall block, and nothing from this conversation is saved.
3. Claude, asked to "turn memory back on", cannot: the Skill call is denied with `NOT_YOURS`.
4. You type `/memory-on`. The flag is removed and a background index catches up.
5. Memory saved before step 1 is available again, unchanged.

## Limits and settings

| Item | Value |
|---|---|
| Flag file | `~/.claude/session-memory/disabled` |
| Resolved as | `${plugin.root}/../../session-memory/disabled` |
| Commands | `/memory-off`, `/memory-on` |
| Check frequency | once per process, cached (`memoryOff`) |
| Switch-talk verbs | turn, switch, toggle, set, put, shut, flip |

There is nothing to configure. The switch is on or off.

## How to see it working

```
$ ls ~/.claude/session-memory/disabled
ls: cannot access ... No such file or directory     (memory is on)
```

Type `/memory-off`, then `ls` again: the file exists, and the next prompt gets no recall block. Type `/memory-on`: the file is gone, and an index runs in the background.

Refusals are logged in the flight recorder (see [../extras/flight-recorder.md](../extras/flight-recorder.md)):

```
{"source":"session-memory","event":"switch_refused","state":"off","by":"mod"}
{"source":"session-memory","event":"switch_refused","tool":"Bash","by":"model"}
```

`by` is `mod` when another mod fired the command, `model` when Claude's tool call was blocked.

## Known limits

- The detector for switch-talk is broad. Harmless sentences like "memory on the disk" match too, so they are hidden from recall, handoff, window, trails and search. They are still stored.
- The flag is cached. Deleting the file by hand in another terminal does not take effect until the process restarts; use `/memory-on`.
- Someone with shell access can still edit the file; the guard only stops Claude and other mods, not you.
- A shell command that changes the flag through a method the guard does not list (an unusual tool, a script) is not caught if it never names the path.
- While off, nothing is saved, so the conversation during that time is not remembered later.
- `/memory-on` re-indexes in the background, so very new memory may appear a moment later.

## Details

- `hooks/register.ts`
  - `memoryOff`: cached flag, read once from the flag file; updated by `/memory-on` and `/memory-off`.
  - `/memory-off` runs `mkdir -p` and `touch` on the flag; `/memory-on` runs `rm -f` and then triggers a background `index.mjs`.
  - Origin check: a command whose `next.origin.plugin` is set and is not `'engine'` is refused, and `switch_refused {state, by:'mod'}` is logged.
  - `tool.call` handler (runs first, even while off): denies with `NOT_YOURS` a Skill or SlashCommand whose input is switch-talk; a Bash command containing `session-memory/disabled` together with touch, rm, mv, cp, ln, tee, truncate, install, dd or `>`; a Write, Edit or NotebookEdit to a path ending in `session-memory/disabled`. Logs `switch_refused {tool, by:'model'}`.
  - Every other handler (prompt recall, notes, window, saving, compaction in `turn.complete`) returns early when `memoryOff` is true.
- `engine/store.mjs` `isSwitchTalk(text)`: NFKC-normalises, lowercases, removes Cf and Mn characters (zero-width and combining marks), turns runs of non-letters and non-digits into one space, then tests three patterns:
  1. `memory ?(on|off)`
  2. `<verb> on|off ... memory`
  3. `<verb> memory (mod|mods|plugin)? on|off`
  Verbs: turn, switch, toggle, set, put, shut, flip.
- Filters using `isSwitchTalk`: `engine/recall.mjs` (recall and handoff), `engine/window.mjs`, `engine/trail.mjs`, the call-memory reader, and the search tools.
- See also [active-window-and-compaction.md](active-window-and-compaction.md) for what stops with the switch, and [../reference/files-on-disk.md](../reference/files-on-disk.md) for the flag file location.
