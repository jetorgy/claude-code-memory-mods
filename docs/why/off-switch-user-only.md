# Why only the user can turn the memory off

One line: the off and on commands work only when you type them; Claude, other mods and tool calls cannot flip the switch.

Related: [../session-memory/off-switch.md](../session-memory/off-switch.md), [../reference/configuration.md](../reference/configuration.md), [research-guards.md](research-guards.md), [read-only-and-install-safety.md](read-only-and-install-safety.md)

## The choice

- The switch is a flag file named `disabled` in the memory folder (`~/.claude/session-memory/`). If it exists, the mod is off. The off command creates it, the on command removes it.
- Three guards in `hooks/register.ts` keep it user-only:
  1. The two commands refuse to run when another mod fires them (the check is `origin.plugin != engine`, that is, the command did not come from you).
  2. A Skill or SlashCommand tool call whose input carries switch talk (a request to turn memory off or on) is denied.
  3. A Bash command or file write that touches the flag file is denied.
- Messages that are only switch talk (`isSwitchTalk`) are never recalled and are left out of the active window, so the talk about switching does not pollute memory.
- The setting is read once and cached until the mods are reloaded.

## The problem it solves

A memory that is on by default can store and re-inject text. You need a reliable way to stop that. If Claude or any helper could also change the switch, then a model that decided "memory is getting in the way" (or a prompt hidden in a web page or file that said to turn it off) could silently disable the system, or turn it back on after you had disabled it. The switch is only trustworthy if only you can use it.

## Why three guards and not one

Each guard closes a different route:
- Guard 1 stops the command being fired by another plugin or an automated source.
- Guard 2 stops Claude invoking the command through its own tools.
- Guard 3 stops the bypass of editing the file directly with Bash or a write.

Any one alone leaves a hole. Together, you typing the command in the chat is the one remaining way.

## Why the switch talk is excluded from memory

If "turn memory off" were stored and recalled, it would be fed back to Claude as past context and could look like an instruction. Leaving those messages out of recall and the window keeps them out of Claude's view.

## Why the setting is cached

Reading a file on every hook would be slow and could race. A cached value is read once and only changes on reload. The trade-off is that after you switch, a reload is needed before every hook sees it. That is a limit, not a feature.

## What the switch does not do

- It disables the mod's own work: recall, saving, window, auto-compaction.
- It does not change Claude Code's own `autoCompactWindow` setting. If you installed with `--autocompact`, the host still compacts at 150,000. See [auto-compact-150k.md](auto-compact-150k.md).
- It does not delete stored memories. See [../session-memory/off-switch.md](../session-memory/off-switch.md).

## Evidence level

From the code. No owner session history was found about why this design was picked; the intent in the code comments is that the switch must be the user's alone. Prompt injection is the plausible reason, but that is inference, not verified.

## Alternatives and trade-offs

- An environment variable: simple, but only read at start and easy to get wrong in a desktop app.
- A setting Claude can change: convenient, but defeats the point.
- A permission prompt each time Claude tries: safe, but noisy.
- Trade-off of the chosen design: if you want Claude to turn it off for you, it will not. You must type the command. Some legitimate uses (scripts) are blocked too.
- Limit: guard 3 looks at the flag path in Bash and file writes. A sufficiently indirect command (building the path in pieces, say) might not be caught. The guards are a safety net against accidents and simple injection, not a security boundary against a determined attacker. That limit is inferred from how pattern checks work, not a tested result.

## How to change it

- Use it: type the off or on command yourself in the chat, or create or delete the flag file in your own terminal.
- Relax a guard: edit the checks in `hooks/register.ts`. Not recommended.

## Related behaviour worth knowing

- Because switch talk is left out of recall, a later session will not find "I turned memory off" in memory. If you need to know the state, check whether the flag file exists.
- If the mods are off, Claude can still use its normal tools and its normal in-chat memory of the current conversation; only this system's saved memory is paused.
- If you suspect a guard blocked something legitimate (a script of yours), the denial message says only the user can switch it. Run the action yourself in a terminal.
