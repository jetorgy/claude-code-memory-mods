# session-memory

A searchable paper trail of every saved Claude Code session, built on @automacene/liminal-memory.

It reads the session logs in ~/.claude/projects (including helper sub-agent transcripts) into Liminal pools: requests, corrections, answers, thinking, tool calls, failures, successes and images. Sessions hang under their project and group. Before each prompt it searches that memory and attaches what clearly matches, labeled as memory and not a request. It records what it attached, so memories that keep being reused grow stronger (darkmind's homeostatic strength model) and memories that fed an answer the user called wrong grow weaker.

Data lives in ~/.claude/session-memory (private to the user). Images are stored once and referenced by pointer. Projects whose folder name contains "personal" are never read; edit ~/.claude/session-memory/config.json to change that.

Commands: /recall <words> searches by hand, /recall stats shows counts, /recall index reads new logs now.

Before every tool call the mod checks the call's history (engine/toolhint.mjs, from the small toolindex.json): a call that failed 2+ times in earlier sessions and never worked is held once per session with the known cause. After any call, relevant memory (a saved lesson for that tool, a repeated failure on that target, a known fix for that exact error) is attached before Claude's next step. Permission outages and declined prompts never count as failures.

Limits, so a turn is never saturated: each lookup returns at most the 5 most related items and only strong matches (it can return fewer or nothing); one budget of 6 items and 3 notes covers a whole turn across the message recall and every tool-call note; nothing is ever shown twice in a session; permission outages and declined prompts are never recalled as failures; and a question with too few meaningful words matches nothing.

New-session handoff: on the first message of a new session the mod first reads in the newest messages of the session just left, then attaches the last 10 exchanges (oldest first), errors that keep happening and are unsolved, saved lessons, and the commands line. `/recall active` shows the active nodes list (strongest first; add a kind such as lesson or failure).

Fixing memory on the spot: the correct_memory tool corrects or forgets a remembered item the moment it is seen to be wrong or outdated (engine/correct.mjs). Each remembered item shows a tag ("ref xxxxxxxx"); the "this exact error has happened N times" note is named by tool plus error text. A correction is an overlay in ~/.claude/session-memory/corrections.json that every lookup reads (recall, the error watcher, the handoff, the tool-call check), so it applies at once and needs no re-index; nothing is deleted, and undo restores the original.
