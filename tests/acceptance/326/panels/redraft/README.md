# #326 AC4, the app's half: blind redraft for #1172

This redrafts one test, `needs_you_and_session_page_share_each_log_pos` in `../panels.rs`, as the design's Dogfooding bullet sets out. Issue #1172 changes what a Needs you row says, and the first draft finds rows by their `ask:…` handle. The first draft stays as it is; this test sits beside it.

## What was read

- `AGENTS.md`, the Proof section, and the Dogfooding bullet in `docs/technical-design.md`.
- Issue #326 in full.
- The sentences of #1172 the job handed over. Scope: "Needs you shows each ask's question, and a row presents that ask's card in the window." AC3: "rows show questions... A handle row fails, naming the ask."
- `../README.md`, `../common.rs`, `../hub.rs`, `../panels.rs` and `../BASE-FAILURE.txt`.
- Base commit `4c0b5899`: `crates/deep-replica/src/snapshot.rs`, `src/shell.rs` and `load_state`; `crates/deep-app/src/record.rs` (`install`, `poll`) and the Needs you arm of `views.rs`.

No implementation of #1172 was read: no other worktree, branch, PR or stash.

## How the criterion is read

As frames from one hub arrive, Needs you and a session's page, fed by one record reader, never disagree about the number of open asks, and both follow the record. The hub sees one subscription for the two views.

- **A row is what a person reads.** The surface is the observed accessibility tree (`from_observed`), the only one the harness gives. A node reads a text if its name or its value contains it.
- **The questions come from the fixture.** Each one is `data.question` on the `ask.created` frame.
- **One row per ask.** A row is the outermost node that reads a question, so a child repeating its row's text is that row. Two rows for one ask count as two.
- **Rows may say more than the question.** The match is by containment, because a row can add its own text, as the base's "· not notified" does.
- **All six questions are looked for at every frame,** so a row left behind after its ask is answered is seen.
- **A handle is never read.** A node in the Needs you window that reads a fixture ask's `ask:…` handle fails at once, naming that ask's question. This holds for answered asks too.

Kept from the first draft: the count agreement at each poll of each frame, the rows equal to the record's open asks in order through six asks created and the first answered, the 10 s limit per frame, and one subscription. It uses the same hub, the same frames and the same session count.

## How to run

```sh
cargo test --locked -p deep-replica --test acceptance_326_panels_redraft
```

It's wired by one `[[test]]` entry with `harness = false`, as `panels.rs` is. It uses `../common.rs` and `../hub.rs` unchanged. It needs macOS; elsewhere it prints INCONCLUSIVE and exits 1.

## The base output

The draft fails on the base, commit `4c0b5899`, at the handle assertion on the frame at `log_pos` 1, naming the question `Which header colour, take 1?`. The output is in `BASE-FAILURE.txt`. The job wrote this draft but never got a build grant, so the session implementing #1172 ran it, with the test file unchanged.

It also failed on a first version of the work whose rows kept the handle as their accessibility value, and it passes on the work once they don't.

## Assumptions a dispute may revisit

- **Nothing else in the window reads a question.** The test activates no row, so it expects no card, and it treats every node reading a question as a row. An app that shows a question in Needs you's window without a gesture, such as a card opened on its own or a sidebar line, would count extra rows here.
- **The handle check covers the whole Needs you window,** sidebar included, not just the rows. The sentences name the rows; the window is the surface the test can read without assuming where rows sit.
- **"Reads" means the accessibility tree, not pixels.** A row whose aria label differs from its painted text would pass here. The first draft had the same limit.
- **The question can be read from the frames.** `hub.rs` puts `data.question` on `ask.created` frames and on `events.read`. Its `inbox.read` rows carry no question, and it answers any new method with `unknown_method`, so an app must take the question from the events.
