# deep-net

## What it is for

The net module (#549; canvas primitives: Shared play over a relay; technical design: The net module), as the app and the web player both run it. Two to eight copies play one piece in lockstep over the one relay it declares, and only inputs travel. It holds no socket, thread or clock: a host hands a copy the time and the frames that arrived, and sends the frames it gives back.

## Where new code goes

- `src/kind.rs`: `net@1`, the module that holds it, its check (one relay, an https host) and a document's match as its net item declares it.
- `src/copy.rs`: one copy of a lockstep match: one message a match step, relay@1's repeat rule, entries on the track by step, player and seq, full-state hashes, the waiting notice, the timeout and the merged record.
- `src/card.rs`: the start card every copy must share, and the first player's link, whose fragment carries the match ID and the opener's card.
- `src/prompt.rs`: the Join prompt's words, the same in the app and the web player.
- `src/play.rs`: the test relay, which runs every copy of a match in one process on its own clock and drops, holds or holds back frames by its seed.
- `src/checks.rs`: net.rollback and net.budget for a lockstep match.

The piece a copy steps is a `Stepper`; `deep-play` gives the one over a document's logic items. Connections live in `deep-relay` (the app's backend and its direct path) and in the web player's page.

## What it may import

`deep-canvas` (the registry, the seal and the canonical form), `deep-relay`'s `wire` (relay@1's frame) and `serde_json`. Never a socket, a thread, a clock, `deep-show` or the hub.

## Deviations

- A match with `window` above 0 plays in lockstep, which never predicts: rollback lands with #551, and until then net.rollback and net.budget answer BLOCKED for such a match.
- net.desync's planted change and its locator land with #550; here a full-state hash a peer doesn't share stops the match on every copy, naming the step and the players.
- A match's module-set digest covers the canvas modules the piece names and its items' kinds need, not the whole build's set: the app's set and the web player's differ by modules no piece in a match reads, and both must play one match.
- The first player's link carries the opener's start card beside the match ID, both in its fragment: a copy that differs is refused from the link alone, before it opens a connection, since relay@1 forwards only frames and a direct path's signaling, and no frame may cross before every copy shares one start.
- A copy steps its logic items only. A physics world in a match's piece isn't stepped live or hashed yet: a follow-up, before a piece with a world plays a match.
