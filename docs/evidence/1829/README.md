# Evidence for #1829: a BLOCKED promised check asks you

`fourth-set.txt` comes from a hand run on Linux (2026-11-15) at commit 8f87cabda, with the hub and CLI built from it. It used #120's wake-up fixture (its stand-in Claude Code, its hub test clock and the real deep-hook) through a throwaway driver that isn't kept in the tree. The agent says "I'll check the deploy again in 20 minutes." and stops, and the promise is set again in each woken turn. After the fourth set, the transcript shows the record's `promise.*` and `ask.created` events, then the real `deep status` and `deep inbox`.

- The record has `ask.created` from the BLOCKED promise (a choice: take or drop, recommended drop), and `promise.blocked` carries its handle (`"ask":"ask:01M7F8Z4…"`). At the base it carries `"ask": null`, with no `ask.created` and an empty inbox (`tests/acceptance/1829/BASE-FAILURE.txt`).
- `deep status` reads the session as "needs you · an ask open" and lists the ask under "Needs you".
- `deep inbox` shows the one ask naming the owner, `service`, with its answers and what happens if you don't answer.

The ask's deadline and default come from your settings, which `deep setup` drafts (`asks.deadline.choice` and `asks.default.choice`). A home without them refuses this ask as it refuses every choice ask raised without its own deadline (BLOCKED, naming the missing value). That behavior is the asks core's and is unchanged here.
