# Why you would want this

## The problem

Claude Code forgets. Every new session starts blank, so you re-explain your project, your preferences and the thing you already fixed last week. Inside one session it gets worse: the conversation grows, gets expensive, and when it is finally compacted into a summary the detail is gone. Meanwhile it will happily repeat a mistake it made in a session you have already closed.

## What these mods do, in plain words

* **It remembers.** Everything you and Claude have said in your saved sessions becomes a searchable memory on your own computer. Before you send a message, it looks for what clearly matches and quietly hands Claude a few short notes ("last time you did this, X worked, Y failed"). If nothing matches well, it adds nothing.
* **It learns from errors.** A command that failed before, and the fix that eventually worked, are remembered. Next time Claude is warned before repeating the failure, and a fix that is known is offered straight away.
* **Long sessions stay light.** Instead of letting one conversation grow forever, it saves the detail to memory and compacts at 150,000 tokens. After the compaction the last 40 to 80 exchanges are shown again word for word, so the thread of what you were doing is not lost. Older detail is still one search away.
* **Claude is nudged to work like a careful professional.** Ask when a request is vague. Deliver the finished version of what you asked for, not the bare minimum. When stuck, or when a precise fact can't be checked from the files, search the web instead of guessing.
* **Small jobs use cheap models.** Grading how hard a message is, and similar side jobs, go to a small model (optionally one running free on your own GPU), and helper agents are capped at four, on Haiku or Sonnet.
* **You stay in control.** `/memory-off` and `/memory-on` switch it instantly. Everything it does is logged by the flight recorder. It runs only on your machine and contacts no server except your own optional local model.

## What you get

| Without it | With it |
|---|---|
| Re-explain your setup every session | Claude already has the relevant history |
| The same error bites you twice | The failure and its fix are recalled |
| Compaction loses detail | Detail is saved first; recent exchanges come back verbatim |
| Long sessions slowly cost more | Conversations are kept to a fixed size by design |
| Claude guesses at technical facts | It is told to look them up |

## Honest expectations

* It helps most if you use Claude Code a lot, across many sessions on related work. On day one your history is whatever the installer imports; it gets better with use.
* Recall is by relevance, not magic. A weak match shows nothing, on purpose, rather than adding noise.
* The notes it adds cost some tokens each turn. The limits are small and fixed (at most 10 items per message), and it keeps the conversation shorter overall. Measured numbers for your own use are in the flight recorder; we make no savings claim beyond that.
* It stores your conversations, including anything sensitive that appeared in them, on your disk. Read [SAFETY.md](../SAFETY.md) before installing.

## Want the details?

[How it works](HOW-IT-WORKS.md) is the technical breakdown. The memory library underneath is [`@automacene/liminal-memory`](https://www.npmjs.com/package/@automacene/liminal-memory).
