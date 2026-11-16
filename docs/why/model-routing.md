# Why the main model is pinned to Sonnet and helpers are limited

One line: the main chat model starts pinned to Sonnet and only changes when you ask (`/route model <haiku|sonnet|opus|fable>`); the mod sets an effort level per prompt, and helper agents are limited to Haiku or Sonnet and at most 4 at a time.

Related: [../model-selector/overview.md](../model-selector/routing.md), [../reference/configuration.md](../reference/configuration.md), [private-local-ollama.md](private-local-ollama.md), [auto-compact-150k.md](auto-compact-150k.md)

## The choice (from `model-selector/hooks/register.ts`)

Model selector:
- Four tiers: haiku, sonnet, opus, fable.
- A grader labels each prompt with a need, and each need maps to a model: clarify -> haiku, simple -> haiku, scoped -> sonnet, unsure -> opus, ambitious -> fable.
- The environment variable `MODEL_SELECTOR_ONLY` pins one model and skips routing.
- Effort is capped below max: never "max", at most xhigh.
- Grading tries the local model first (see [private-local-ollama.md](private-local-ollama.md)), then Haiku.
- `POLL_EVERY = 4` steps for the periodic re-check during long agent work.

Current behaviour: the session model always starts as Sonnet. In auto mode it stays Sonnet unless you switch it with `/route model <name>`; only the effort follows each prompt. The need-to-model table above applies in always mode. The owner chose this pin so the router never silently moves the main chat to a different model; to change the main model, ask for it.

Two modes:
- auto: the model is the Sonnet pin (or whatever you set with `/route model`); only the effort follows each prompt, to protect the prompt cache.
- always: re-picks the model on every prompt. A switch re-reads the whole chat at full price, so this costs more.

Subagent router:
- `MAX_RUNNING = 4` helper agents at once.
- Helpers run only on Haiku or Sonnet. Opus is never allowed for helpers.
- `Explore` and `claude-code-guide` agents go to Haiku directly.
- Otherwise a Haiku low-effort grader (6 s timeout, 120 tokens) decides; if it fails, Sonnet is the default.

## The problem it solves

Most prompts do not need the biggest model. "Rename this variable" on the most capable model is slower and costs several times more than needed. Helper agents multiply cost: several of them on the top model at once can use a lot very quickly. Routing and limits keep cost and speed proportionate to the task.

## Why the cache matters (auto versus always)

The conversation is re-sent every turn and the provider caches it so repeats are cheap. Cache is per model. Switching model mid-conversation drops the cache, and the whole chat is read again at full price. So in auto mode the model is chosen once, on the first real task, and only the cheaper-to-change effort follows. Always mode is available for owners who prefer the per-prompt fit even at that cost. The old docs describe routing as per-message; in the code that is true only in always mode.

## Why no Opus for helpers, and a cap of 4

Evidence level: from the code. No owner history was found for either number; the reasons are inference, not verified.

- Helpers often run in parallel and in loops. Keeping them to Haiku or Sonnet bounds the worst-case cost. Opus stays available to the main conversation.
- 4 at once bounds both cost and the load on your machine and rate limits.

## Why effort is capped below max

A "max" effort uses a very large amount of thinking per prompt. The cap (at most xhigh) is a cost guard. The reasoning is inferred from the constant and its comment, not an owner statement.

## Why the local model grades first

Grading is a tiny job (classify a prompt). The local model costs nothing and sends no text away. If it is not running, or the GPU is busy, Haiku is used. A grader call with 120 tokens and a 6 s timeout keeps even the fallback cheap and fast.

## Limits and caveats

- The grader can be wrong. A mislabelled hard prompt on Haiku gives a worse answer; you can override the model yourself.
- The mapping (need to model) is a hand-written table, not learned.
- Not measured: how often the grader agrees with a human, or how much money it saves. The owner has not run that comparison; see [vibe-coded-and-limits.md](vibe-coded-and-limits.md).
- A code comment in `register.ts` says the local model stays loaded "30 minutes"; the code uses a 3 minute keep-alive. The code is what runs.

## Alternatives and trade-offs

- Always use one model: predictable, but overpays or underperforms.
- Let the user choose each time: precise, constant interruptions.
- Always re-route: best fit per prompt, loses the cache.
- Allow Opus for helpers: stronger helpers, risk of runaway cost.

## How to change it

- Pin a model: set `MODEL_SELECTOR_ONLY` in the environment.
- Mode (auto or always), local on/off/auto: the mod's commands; see [../reference/configuration.md](../reference/configuration.md).
- Mapping, `MAX_RUNNING`, effort cap, `POLL_EVERY`: constants in `register.ts`; reload plugins after editing.
