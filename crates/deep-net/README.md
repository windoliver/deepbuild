# deep-net

## What it is for

The net module (#549, #550; canvas primitives: Shared play over a relay; technical design: The net module), as the app and the web player both run it. Two to eight copies play one piece in lockstep over the one relay it declares, and only inputs travel. Every player's entry, a peer's as the viewer's own, is refused alike on every copy when the piece doesn't declare its control or its value is out of range; a trap ends the match as faulted on every copy; and a full-state or track hash a peer doesn't share stops the match, after which the copies locate, from hashes alone, the first player and step whose entries differ, or the first step and field. It holds no socket, thread or clock: a host hands a copy the time and the frames that arrived, and sends the frames it gives back.

## Where new code goes

- `src/kind.rs`: `net@1`, the module that holds it, its check (one relay, an https host) and a document's match as its net item declares it.
- `src/copy.rs`: one copy of a lockstep match: one message a match step, relay@1's repeat rule, entries on the track by step, player and seq, full-state hashes with the track hash beside them, refusals, faults, the waiting notice, the timeout and the merged record; and planted defects, which a check or a test plants in one copy's state.
- `src/message.rs`: one player's message for one match step: its entries, the full-state and track hashes in 20 bytes, how its copy ended, and its locator's parts.
- `src/locate.rs`: what a copy's locator finds and sends once a desync stopped its match, and where two copies parted.
- `src/card.rs`: the start card every copy must share, and the first player's link, whose fragment carries the match ID and the opener's card.
- `src/prompt.rs`: the Join prompt's words, the same in the app and the web player, with the courtesy line for a piece that reads `match.me` (#552).
- `src/draw.rs`: random draws after commit (#552): a copy's commitment once it confirms a drawn step, its bits once it holds every commitment, the check of each player's bits against their commitment, and the seeded test source a check plays with in place of the platform's secure one.
- `src/play.rs`: the test relay, which runs every copy of a match in one process on its own clock and drops, holds or holds back frames by its seed.
- `src/checks.rs`: net.rollback, net.desync and net.budget for a lockstep match; `kind.rs` registers them, run through what the build binds (`deep-play`'s runs over a document's logic items).

The piece a copy steps is a `Stepper`; `deep-play` gives the one over a document's logic items. Connections live in `deep-relay` (the app's backend and its direct path) and in the web player's page.

## What it may import

`deep-canvas` (the registry, the seal and the canonical form), `deep-relay`'s `wire` (relay@1's frame) and `serde_json`. Never a socket, a thread, a clock, `deep-show` or the hub.

## Deviations

- A match with `window` above 0 plays in lockstep, which never predicts: rollback lands with #551, and until then net.rollback and net.budget answer BLOCKED for such a match.
- The locator steps a copy again from the piece's start, the checkpoint at or before every hash, not from the nearest checkpoint ring entry: a desync ends the match, so it costs one run of the steps so far.
- A match's module-set digest covers the canvas modules the piece names and its items' kinds need, not the whole build's set: the app's set and the web player's differ by modules no piece in a match reads, and both must play one match.
- The first player's link carries the opener's start card beside the match ID, both in its fragment: a copy that differs is refused from the link alone, before it opens a connection, since relay@1 forwards only frames and a direct path's signaling, and no frame may cross before every copy shares one start.
- #552: a `draw.reveal` entry carries the match's ID beside its step and bits, so a record's track alone replays its draws (the design's draw hashes the match ID, and a replay is given only the track).
- #552: a copy's `match.me` reaches a 3D frame as the drawn document's `match.me` (scene3d evaluates a document, not a session's view inputs); a 2D mark set's `seen` column reads it as the scheduler's `view(match.me)`. `match`'s `views` draw 3D pieces only.
- A copy steps its logic items only. A physics world in a match's piece isn't stepped live or hashed yet: a follow-up, before a piece with a world plays a match.
