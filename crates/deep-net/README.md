# deep-net

## What it is for

The net module (#549, #550, #551; canvas primitives: Shared play over a relay; technical design: The net module), as the app and the web player both run it. Two to eight copies play one piece over the one relay it declares, in lockstep or within a rollback window, and only inputs travel. With a window a copy predicts a player's input as their last one, runs at most the window past the last step it holds every player's message for, and rolls back to a late entry's step, every canvas module but media restoring its rollback checkpoint there; a copy that leads its peers holds its clock one step in every 10. Every player's entry, a peer's as the viewer's own, is refused alike on every copy when the piece doesn't declare its control or its value is out of range; a trap ends the match as faulted on every copy; and a full-state or track hash a peer doesn't share stops the match, after which the copies locate, from hashes alone, the first player and step whose entries differ, or the first step and field. It holds no socket, thread or clock: a host hands a copy the time and the frames that arrived, and sends the frames it gives back.

## Where new code goes

- `src/kind.rs`: `net@1`, the module that holds it, its check (one relay, an https host) and a document's match as its net item declares it.
- `src/copy.rs`: one copy of a match: one message a match step, relay@1's repeat rule, entries on the track by step, player and seq, full-state hashes with the track hash beside them, refusals, faults, the waiting notice, the timeout and the merged record; and planted defects, which a check or a test plants in one copy's state. `src/copy/seats.rs` (#277): in a piece whose logic reads `net.seats`, seats that change while the match runs: a leave agreed at one step after the `holds` exchange, an absent copy, its catch-up and its `back`.
- `src/copy/rollback.rs`: a copy with a rollback window (#551): prediction, the window, one rollback a tick to the earliest late entry, hashes and the record only from confirmed steps, a trap held until its step is confirmed, the lead rule, a seek after the match.
- `src/copy/feel.rs`: what net.feel reads on one copy (#280): its stalls, each from the time its step was due to the frame that let it run, each rollback's depth, and each named item's correction at its last frame's time across a rollback.
- `src/message.rs`: one player's message for one match step: its entries, the full-state and track hashes in 20 bytes, how its copy ended, and its locator's parts.
- `src/locate.rs`: what a copy's locator finds and sends once a desync stopped its match, and where two copies parted.
- `src/card.rs`: the start card every copy must share, and the first player's link, whose fragment carries the match ID and the opener's card.
- `src/prompt.rs`: the Join prompt's words, the same in the app and the web player, with the courtesy line for a piece that reads `match.me` (#552).
- `src/draw.rs` and `src/copy/draws.rs`: random draws after commit (#552): a copy's commitment once a drawn step is confirmed (in lockstep as it runs, with a window as it settles), its bits once it holds every commitment, the check of each player's bits against their commitment, and the seeded test source a check plays with in place of the platform's secure one.
- `src/play.rs`: the test relay, which runs every copy of a match in one process on its own clock and drops, holds or holds back frames by its seed, holds a chosen message from one copy until it has run a step, and gives each player a one-way latency; with net.feel's profile (#280), each player's own latency plus a seeded jitter, seeded spikes and a loss from its own seed.
- `src/checks.rs`: net.rollback, net.desync and net.budget; `kind.rs` registers them, run through what the build binds (`deep-play`'s runs over a document's logic items and worlds).
- `src/window.rs`: net.rollback's schedules for a window and net.budget's five runs, each frame the live step and the full window restored and stepped again (#551); each host's part of net.budget, the window every one of its five runs fits (`windows`), and the rule that a piece declares at most the window each host it plays on reports (#280); each run's `checkpoint_ms`, and a failure that names an occurrence's `kind` (#553).
- `src/message.rs` also writes a draw's commitment and reveal compactly, beside the other entries as JSON (#553).
- `src/feel.rs`: net.feel (#280): its check input, which an agent's patch never changes (`locked`), its run of `players` copies over the test relay's seeded network, and its readings against its bounds.

An action game picks its window from net.budget's report: it declares at most the smallest window the report gives for the hosts it plays on (`on`), with the delay its players' latency needs, or plays lockstep (window 0) where the report gives 0, since the class's frame CPU stays as the class table sets it. net.feel then bounds what its players would feel on a seeded network: how long copies stall, how deep rollbacks go and how far other players' items jump when a rollback corrects them.

The piece a copy steps is a `Stepper`; `deep-play` gives the one over a document's logic items and its worlds, which holds the saves its steps ask for until `confirmed` reaches their step (#553). A copy hands its stepper its clock (`sound`) before each tick's rollback, so `deep-show`'s media module (`src/voiced.rs`) renders the output a block behind the steps, starts voices from new occurrences and fades out over 5 ms those a rollback dropped. Connections live in `deep-relay` (the app's backend and its direct path) and in the web player's page.

## What it may import

`deep-canvas` (the registry, the seal and the canonical form), `deep-relay`'s `wire` (relay@1's frame) and `serde_json`. Never a socket, a thread, a clock, `deep-show` or the hub.

## Deviations

- A copy with a window counts its peers' first `delay` messages held from the start, since every copy knows they are empty; a lockstep copy still waits for them.
- net.budget's web part runs where the host gives it Chrome (deep-show's scenario `chrome`): the app serves the web player's full set and the piece on 127.0.0.1 and measures the same stretch of the same track there; elsewhere it answers BLOCKED with one ask.
- The locator steps a copy again from the piece's start, the checkpoint at or before every hash, not from the nearest checkpoint ring entry: a desync ends the match, so it costs one run of the steps so far.
- A match's module-set digest covers the canvas modules the piece names and its items' kinds need, not the whole build's set: the app's set and the web player's differ by modules no piece in a match reads, and both must play one match.
- The first player's link carries the opener's start card beside the match ID, both in its fragment: a copy that differs is refused from the link alone, before it opens a connection, since relay@1 forwards only frames and a direct path's signaling, and no frame may cross before every copy shares one start.
- Physics keeps no checkpoint ring of its own in a match beyond its rollback ring, so a seek after the match steps a world again from its start, while logic restores its own ring's nearest checkpoint.
- #552: a `draw.reveal` entry carries the match's ID beside its step and bits, so a record's track alone replays its draws (the design's draw hashes the match ID, and a replay is given only the track).
- #552: a copy's `match.me` reaches a 3D frame as the drawn document's `match.me` (scene3d evaluates a document, not a session's view inputs); for a 2D mark set the core's column view stamps it on the set's `seen` column. `match`'s `views` draw 3D pieces only.
