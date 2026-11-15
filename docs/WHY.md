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

## How this is different from other Claude memory tools

Other options exist, and they are good at what they do. Claude Code's own `CLAUDE.md` files and auto memory hold notes you or Claude write down. Plugins such as [claude-mem](https://emelia.io/hub/persistent-memory-claude-code-claude-mem) capture sessions through hooks and search them later. Services such as Mem0 connect as an MCP server (the model has to decide to call them) and are mostly cloud based, according to [this comparison](https://vectorize.io/articles/claude-code-memory-vs-mem0-vs-hindsight). That is secondhand, and several of those pages are written by competing vendors, so check each project's own docs.

What these mods do differently:

* **It manages the whole conversation, not only recall.** Most memory tools answer "what do we remember?". These also decide what stays in front of Claude: save detail first, compact at 150k, show the last 40 to 80 exchanges verbatim, and tune that window to how fast your sessions fill.
* **It learns from what went wrong.** Failures, their fixes and your corrections are first-class memories. A memory that fed an answer you called wrong gets weaker; one that keeps proving useful gets stronger; stale ones fade to cold storage instead of piling up.
* **It is automatic and labelled.** The notes are attached by a hook before Claude answers, so it does not depend on the model remembering to call a memory tool. Each note is marked as memory, not as your request, and a weak match adds nothing.
* **It finds by keyword and by meaning, both on your own machine.** Recall uses keyword relevance (BM25) from [Liminal Memory](https://github.com/Automacene/liminal-memory), which is predictable: the same question returns the same memories, and a match can be explained. On top of that it can use a small local embedding model (`nomic-embed-text`, about 274 MB, run through your own Ollama) so a memory that says the same thing in different words is found too. There is no vector database and no cloud: the vectors are one file next to the memory. Without the model, it quietly falls back to keywords only.
* **It stays on your machine.** No cloud memory service, no account, no other server. Its only network address is an optional model on your own computer.
* **You can audit it.** The installer's setup prompt makes a model read the code before anything runs, the repo has a safety file and checksums, a flight recorder logs every decision, and `/memory-off` stops it instantly.
* **It is more than memory.** The same bundle picks a cheaper model for small jobs, nudges Claude to ask and to search the web, and caps helper agents.

It is not a replacement for `CLAUDE.md`: keep writing your standing rules there. This sits alongside it and covers what you would never think to write down.

## Honest expectations

* It helps most if you use Claude Code a lot, across many sessions on related work. On day one your history is whatever the installer imports; it gets better with use.
* Recall is by relevance, not magic. A weak match shows nothing, on purpose, rather than adding noise. Matching by meaning needs the optional local embedding model; without it, a paraphrase that shares no words with the memory can be missed, and even with it a loosely worded question can fall just under the bar.
* The notes it adds cost some tokens each turn. The limits are small and fixed (at most 10 items per message), and it keeps the conversation shorter overall. Measured numbers for your own use are in the flight recorder; we make no savings claim beyond that.
* It stores your conversations, including anything sensitive that appeared in them, on your disk. Read [SAFETY.md](../SAFETY.md) before installing.

## Want the details?

[How it works](HOW-IT-WORKS.md) is the technical breakdown. The memory library underneath is [`@automacene/liminal-memory`](https://www.npmjs.com/package/@automacene/liminal-memory).
