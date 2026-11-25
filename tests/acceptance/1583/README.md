# Acceptance tests for #1583: what a card shows can't hide anything

Written first, blind, by a job that never saw an implementation of #1583; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue has five checkbox criteria, AC1 to AC5 in the body's order. Each `describe` and `it` title starts with its
criterion's ID, `AC<n> #1583.<h8>`: the first 8 hex digits of the SHA-256 of the checkbox's text after `- [ ] `,
trimmed, white space collapsed, as `scripts/proof-change.mjs` reads it.

| # | ID | Criterion |
|---|---|---|
| 1 | `#1583.f0f56109` | Each of a zero-width space, a right-to-left override and a tag character in an option draws as a visible escape. A planted card that draws them raw fails, naming the character |
| 2 | `#1583.3d92be0c` | An authority card with one shows the warning, and the warning is a safety row |
| 3 | `#1583.89af5457` | The stored ask is byte-equal to what was raised |
| 4 | `#1583.e10b90b9` | Plain text in Chinese, Arabic and with emoji draws unchanged and adds no warning |
| 5 | `#1583.69ea36be` | A channel's summary carries the same escapes |

## What was read

- **The issue** as saved on November 24, 2026 (no comments): its opening, every line of its Scope, the five criteria
  and its Proof, "The planted card on this branch and the merge base, beside the plain-text fixtures." Of the issues it
  names, only what this checkout holds: #1510's suite (`tests/acceptance/1510`) and the design's words for #1464's
  check. #2, #1464 and #1530 were not read.
- **The design**, `docs/technical-design.md`: Threats, and what stops each one (Approvals that drift, Hostile text in
  what DeepBuild reads, Signatures used again, the MCP row's sentence on invisible Unicode); An ask, and your answer
  getting back (Where asks reach you, Tasks only you can do); States people see (the one row shape, a session's one
  name, the app's one table of words); The trusted path is a device you paired (`channel.answer` signed over `{ask,
  revision, card_hash, answer}`); the Channel block; How we know version 0 works (Criteria to tests, Wrong programs,
  Dogfooding, Tests written first, The quiet check, which names the safety list). `docs/canvas-primitives.md`, Question
  card, whose Semantics hold the issue's sentence. `docs/parallel-proof.md`, sections 5 to 7. `AGENTS.md`.
- **The base** `86376102` (origin/main), for call shapes and conventions only: `packages/hub/src/{visible,channels,
  inbox,list,rows,plant,human-answers}.ts`, `packages/asks/src/index.ts` (raise, the fold at five open asks of a
  thread), `packages/channels/paseo`, `crates/deep-app/src/{question,kinds,states,plain,copy,list,views,notify,
  empties}.rs`, `crates/deep-app/{Cargo.toml,moves.json}`, `scripts/{proof-runs,proof-binaries,twins-lint,plant-lint,
  wait-ratchet,copy-table,lanes}.mjs`, and the suites `1510`, `1738`, `65` with its redrafts, `1580`, `16`, `24`,
  `34`, `1101`, `1461`, `2018` and `1606-redraft-ac5-ac9`.

## What the base does, field by field

`visible` (`packages/hub/src/visible.ts`, and the app's twin of it in `question.rs`) writes each marked character as
its escape: `\u{200b}`, `\u{202e}`, `\u{e0041}` for the three this issue names. Where the base passes each field
through it:

| Field | The app | `deep` | A channel's card |
|---|---|---|---|
| A question | The card's row, the list's row, the notification: yes | `deep inbox`, `deep status`: yes | `summary`: **no**, raw |
| An option | The card's option rows and its default line: yes | `deep inbox`'s "answer with" line: yes | `options[].label`: **no**, raw |
| A command | The card's step rows: yes | `deep inbox`'s plan steps, `deep status`'s calls: yes | `plan.steps` beside the plan's hash: raw, and not asserted here |
| A path | The card draws none of a plan | `deep inbox`'s `changes`: yes | none in the summary |
| A session's name | `states::Table::title`, which the sidebar, the page's heading and the notification's title all call: yes (#1738, #2018) | `deep`, `deep status`, `--why`: yes | none drawn |
| A link's target | A URL in an ask's text is part of its question: yes | part of the question, and `deep inbox`'s "opens" line: yes | part of the `summary`: **no**, raw. The item's `link` is the hub's own `deepbuild://ask/<id>` |

The base has no warning on any card, no safety list (its only mentions are the design's bullet, the head comment of
`empties.rs` and #1461's README), and its card hash, `cardHash` in `channels.ts`, is the SHA-256 of the RFC 8785 bytes
of `{summary, options}` of the item it sent, whose text is the text as stored. So of the Scope's last line, what the
base lacks is the channel's card (summary and option labels), the hash over the text as shown, and the warning; a
session's name and a link's target in the app and in `deep` it already draws right, and their tests here pass on it.

## How to run

Node 24.22 or newer and cargo on `PATH`, on macOS, from the checkout's root.

```sh
npm ci                                              # once, if node_modules is missing
npm run build --workspaces                          # channel.test.ts runs packages/cli/dist/main.js and the hub it starts
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # the hub won't start without target/debug/deep-hook
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo test --locked -p deep-app --features env-plants --test acceptance_1583 --no-run   # app.test.ts runs this itself; built before, it compiles nothing
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1583 channel.test.ts --testTimeout=600000 --no-file-parallelism
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1583 app.test.ts --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1583/tsconfig.json
```

- `channel.test.ts` needs the packages built and `deep-hook`. `app.test.ts` needs cargo, and the `[[test]]` entry
  below; it starts no hub.
- Each hub runs with `HOME` in a temp folder under `/tmp/dh16-*` (#16's `makeHome`), so its root is
  `<tmp>/h/.deepbuild` and the real `~/.deepbuild` is never touched. The OS confirmation is #34's stand-in, saying yes.
  Every process a test starts is stopped by PID and its folders removed (#16's `cleanup`). No network beyond
  127.0.0.1, no model. Nothing is timed: a test waits for a card or an event, and a wait that runs out is BLOCKED.
- The suite runs alone (`lane.json`): `app.test.ts` builds a test target of deep-app with cargo, which no
  `DEEP_BIN_DIR` holds, since it is no binary of the workspace and needs the `env-plants` feature.
- With `--root` here Vitest may write `tests/acceptance/1583/node_modules/.vite`; delete it before committing. The
  base runs left none.
- A missing build is BLOCKED, never a pass: `channel.test.ts` names the CLI or the hub that didn't start,
  `app.test.ts` the missing `[[test]]` entry or the cargo error.

## The surface under test

What the tests reach, and every name an implementation must provide exactly as written. **Mine** marks a name this
suite chose, because the issue and the design leave it open.

### What exists at the base, read as the base's suites read it

- **A channel's card**: the item the paseo channel's provider got, read from #65's stand-in provider
  (`../65/fixtures/providers.ts`, `Provider.latest`). The world is #1580's: asks raised through the real asks core
  into the ledger before `deep hub run` starts, `channels.json` routing every kind to `paseo`, the channel installed
  with `deep install packages/channels/paseo`, a phone paired with `device.pair`. paseo is a device channel, so an
  open choice's card carries `summary` and `options: [{id, label}]`.
- **The card hash**: `card_hash` as #65 fixed it and the base computes it, the SHA-256 hex of the RFC 8785 bytes of
  `{summary, options}` of the card signed over (`../65/fixtures/providers.ts`, `cardHash`). The phone signs in
  #1579's format, `channel.answer` over `{ask, revision, card_hash, answer}` with the params beside `signed`. A
  refusal is the record's `channel.refused` with `data.field`; a counted answer its `ask.answered`.
- **`deep inbox`**: the built CLI's stdout kept as bytes, as #1510's suite reads it; an ask's lines are the line
  holding its handle and the indented lines under it.
- **The record**: `events.read` on the hub's socket, after the cards went out, `deep inbox` ran and the phone
  answered.
- **The app's card**: `deep_app::question::Controller::present(events, ask, now, slot, Faults::default())` on record
  events, then `lines()`, as #1510's `app/card.rs` reads it. **A session's name in the app**:
  `deep_app::states::Table::seeded(rows).title(session)`. This is a second way of reading that name, beside #1738's,
  which draws the sidebar, the heading and the notification in a test window. The reason: every one of those surfaces
  calls this one function for the name, the check is of the text alone, and the card's target opens no window.

### What an implementation provides

1. **The test target `acceptance_1583`** (mine): a `[[test]]` entry of `crates/deep-app/Cargo.toml` for
   `app/card.rs`, `harness = false`, word for word under "What the implementer adds". `app.test.ts` builds it with
   `cargo test --locked -q -p deep-app --test acceptance_1583 --features env-plants --no-run` and runs the built file
   as `<target> cards <file>`. `app/card.rs` judges nothing; it prints each card's lines and each session's name.
2. **The planted card `card-draws-raw`** (mine; criterion 1's "planted card that draws them raw"). It is the app's
   question card planted as the app's other cards are: `deep_app::plain::planted("card-draws-raw")`, which reads
   `DEEP_HUB_PLANT` only in a build with deep-app's `env-plants` feature and is false in every other build.
   - What it does: while it is selected, `question::Controller::rows()`, and so `lines()`, gives every row's words as
     the record holds them, none passed through `visible`. A zero-width space, a right-to-left override and a tag
     character in an option's label reach the card's text raw.
   - What it doesn't do: it changes no other thing the card reads, draws or sends. The rows are the same rows in the
     same order, and each option still shows. It is the app's alone: the hub's `PLANTS` doesn't list it, and no hub
     or CLI reads it.
   - How the tests reach it: `app.test.ts` runs the same built target twice, once with no plant and once with
     `DEEP_HUB_PLANT=card-draws-raw` in its environment, and puts both through one check.
   - The lanes reach it through `twins.json`, which names the twin `card-draws-raw` under `#1583.f0f56109`:
     `twins/card-draws-raw/lines.json` makes `plain::planted("card-draws-raw")` true in every build, by one edit of
     `crates/deep-app/src/plain.rs` at the line `pub fn planted(name: &str) -> bool {`, which must stay as the base has
     it for the twin to apply.
   - On the merge base it is the base's `question.rs` with one place changed, `rows()`:

     ```rust
         pub fn rows(&self) -> Vec<Row> {
             // #1583's planted card draws every row's words as the record holds them, in a test build only.
             if crate::plain::planted("card-draws-raw") {
                 return self.unmarked_rows();
             }
             self.unmarked_rows().into_iter().map(Row::marked).collect()
         }
     ```
3. **The safety list `crates/deep-app/safety.json`** (mine, file and shape). The design calls it "one table of
   strings, each with the issue that requires it". It sits beside `moves.json`, the quiet check's other table, and
   not in `crates/deep-app/copy/`, where every JSON file is read as a language's table. It is one JSON array. Each row
   is an object with at least
   - `"string"`: the words as the app draws them in English, which are an entry of `crates/deep-app/copy/en.json`,
     with that entry's `{0}`, `{1}` placeholders kept where it has any;
   - `"issue"`: `"#<number>"`, the issue that requires the string.

   A row may hold other keys; the tests read these two. One example row, its wording an example only, since the
   issue fixes none:

   ```json
   [
     { "string": "This text holds characters you can't see, drawn as their escapes", "issue": "#1583" }
   ]
   ```

   The warning an authority card draws must be a line of its own whose words are a row with `"issue": "#1583"`: the
   same string, each placeholder standing for any text. A row whose string is placeholders alone counts for nothing.
4. **The warning** is a line of the card's text (`lines()`), drawn on an authority card whose question, an option's
   label or a step's command holds one of the three characters, and not on the same card without it. No copy key is
   named here: the tests find the line by what it adds to the card and by the safety list.
5. **The escapes** on a channel's card are the base's own: `\u{200b}`, `\u{202e}`, `\u{e0041}`, lower-case hex in
   braces, as `visible` writes them, in `summary` and in each option's `label`, with every other character unchanged.
   An option's `id` stays as raised. `card_hash` stays the hash of `{summary, options}` of the card as sent.

## The fixtures

`texts.ts` holds every text, each invisible character written as its escape in the source.

- The three characters: U+200B ZERO WIDTH SPACE, U+202E RIGHT-TO-LEFT OVERRIDE, U+E0041 TAG LATIN CAPITAL LETTER A.
- `hidden`: a question holding all three between ASCII words, and three options, each label holding one.
- `link`: a question quoting `https://files.example/…` whose path holds all three.
- A session's name holding all three.
- Plain text: a question and two options in Chinese, in Arabic, and with emoji as people type them (a skin-tone
  modifier, U+FE0F after a heart, a family joined by U+200D), which the base's `visible` leaves alone, as #1510 read
  it. No subdivision flag: those are spelled with tag characters, which criterion 1 says are drawn as escapes.
- The app's approvals: one in ASCII (`Run \`git push origin main\` in shop?`, `Allow`, a one-step plan running `git
  push origin main`), the same with one character in its question, in its allowing option or in its command, nine in
  all, and three plain ones in Chinese, Arabic and emoji.

The hub's world holds five asks raised in no session, as #1580's are. That is the most one thread holds before the
asks core folds a further ask into an exception, so a sixth must not be added to `channel.test.ts`.

## The judges

`judge.ts`, Node's built-ins only. Each takes text and starts nothing.

- **`drawn(where, held, shown)`**, criterion 1's check and the one the planted card goes through. For each of the
  three characters the stored text holds: no string of the place it is drawn in holds it raw, and one holds the run
  of text around it (between blanks) with the escape where the character was. A finding says `raw`, `removed` (the
  text around it is there with nothing in its place) or `missing`.
- **Naming the character.** Every finding's message starts with the character's code point and Unicode name, as
  `U+200B ZERO WIDTH SPACE is drawn raw in …`, and quotes the text with each raw character written `⟦U+200B⟧`. The
  planted card's test takes the planted card to fail only when the check gives exactly three findings, `U+200B raw`,
  `U+202E raw` and `U+E0041 raw`, each message holding its code point. A card that fails another way (it doesn't
  present, it leaves the options out, it writes another escape) gives `missing` or `removed` findings or is BLOCKED,
  and doesn't count as the planted card failing.
- **`added(withOne, plain, hidden)`**, criterion 2: the lines a card draws that the same card without the character
  doesn't, the character's escape aside. The warning is among them. A line of the plain card the other lacks is
  reported too, so a card that draws the character some other way can't pass as "it added a line".
- **`safetyRows`, `isRow`**: the safety list read from the checkout, and whether a line is a row's string.
- **`unchanged`, `sameCard`**, criterion 4: a plain card draws each text as it is and exactly the lines of the same
  card in ASCII; a channel's summary is the question and each label the label.
- **`sameBytes`**, criterion 3: UTF-8 bytes equal.

## Each criterion to its tests

"Base" is what each did on the merge base, with the reason; `BASE-FAILURE.txt` holds the run, each failure trimmed to
its assertion.

| AC | File | Test | Base | The wrong program it fails on |
|---|---|---|---|---|
| 1 | `channel.test.ts` | On a channel's card, each option's label shows its character as its escape, under its ID | FAIL: the labels reach the relay raw | the merge base |
| 1 | `channel.test.ts` | A link's target shows each character as its escape in a channel's summary | FAIL: raw | the merge base |
| 1 | `channel.test.ts` | `deep inbox` prints the options, the question and the link's target with their escapes | PASS: #1510 did this; it must stay so | a `deep inbox` that prints a label, a question or a link raw, or strips the character |
| 1 | `app.test.ts` | On the app's card, each option's label draws its character as its escape | PASS: #1510 did this; it must stay so | the planted card `card-draws-raw` (the twin) |
| 1 | `app.test.ts` | The planted card fails the same check, which names each character as raw | FAIL on the base as it is: it has no such plant, so the card it draws under that name passes the check, and the test's assertion gets no finding. PASS on the base with `question.rs` changed as above: that card draws the three raw | the merge base |
| 1 | `app.test.ts` | In the app, a link's target in a question and a session's name draw their escapes | PASS: #1510, #1738; it must stay so | a card or a `title` that draws either raw |
| 2 | `app.test.ts` | Each of nine approvals holding one character draws a line the ASCII approval doesn't | FAIL: nothing on the card says so | the merge base |
| 2 | `app.test.ts` | That line is a `#1583` row of `crates/deep-app/safety.json`; the ASCII approval draws no such row | FAIL: no safety list, no warning | the merge base |
| 3 | `channel.test.ts` | Each ask's question, option IDs and labels in `ask.created`, read back at the end, are the bytes raised | PASS: the base keeps them; it must stay so | an asks core or hub that writes escapes, or strips, on the way in or when it draws |
| 4 | `channel.test.ts` | Chinese, Arabic and emoji: the summary is the question, each label the label, and `deep inbox` holds each byte for byte | PASS; it must stay so | a hub that escapes or strips text beyond the marked set, such as an emoji's joiner |
| 4 | `app.test.ts` | Chinese, Arabic and emoji approvals draw each text as it is and no line the ASCII approval doesn't | PASS; it must stay so | a card that warns on, or escapes, plain text |
| 5 | `channel.test.ts` | The summary the relay got for the `hidden` question shows each character as its escape | FAIL: raw | the merge base |
| 5 | `channel.test.ts` | The card hash covers the text as shown: a signature over the card with the stored text is refused naming `card_hash`; one over the card as shown counts | FAIL: on the base the stored text is the shown text, so that signature counts | the merge base |

One planted thing, the one criterion 1 names. The tests marked PASS guard behaviour that must not change; no twin is
planted for them, and each names the wrong program it would catch.

## Readings where the issue and the design leave a choice

- **"A visible escape"** is the escape the base's `visible` already writes for the character, exactly. Criterion 5
  says "the same escapes" and the Scope "the same rule", so a channel's card is held to the spelling the card and
  `deep inbox` already use, and no other spelling is accepted anywhere.
- **"A tag character"** is U+E0041. Any of U+E0000 to U+E007F is one, and the base marks them all.
- **"A planted card"** is the app's question card, the card #1510 made draw escapes, planted to draw them raw again.
  The Proof's "on this branch and the merge base" is read as: the same planted card can be built on both, on the
  branch by the plant's name, on the merge base by the one changed place above.
- **"The first criterion is proven against those fields"** (the Scope's last line): the check runs on an option, as
  the criterion says, and on a link's target and a channel's summary, each on the channel's card, where the base
  fails, and in `deep inbox` and the app, where it passes. A session's name is drawn on no card and no channel at the
  base, so it is checked where the app draws it.
- **"A link's target"** is the address of a URL in an ask's text, which the design draws "as plain text with its
  host". The tests check the address's characters, not how the host is shown.
- **"An authority card with one"**: an approval whose question, allowing option's label or one step's command holds
  one of the three characters. Those are the fields of the Scope's list the base's authority card draws.
- **"Shows the warning"**: a line of the card's text the same card without the character doesn't draw. Its wording,
  its place among the rows and its copy key are the implementation's. More than one added line is allowed; one of
  them must be the safety row.
- **"The warning is a safety row"**: with #1464 open and nothing of its table in the base, the row is read from the
  file named above. #1464's check can read the same file.
- **"The card hash covers the text as shown"** (Scope; no criterion of its own, so it is tagged AC5, whose card it
  is): the hash a phone signs is over `{summary, options}` as the relay got them, escapes and all, so a signature
  over the same card with the stored text is refused at `card_hash`. What the hash covers is otherwise #65's.
- **"The stored ask"**: its `ask.created` as `events.read` returns it, the question and each option's ID and label.
  The asks are raised through the real asks core before the hub starts, as #1510's suite raises them.
- **"Adds no warning"** on a channel is read as the summary being the question, nothing after it.
- **"`deep`'s own output"** is `deep inbox`, which prints an ask's question and options. `deep` and `deep status`
  print a session's name through the same `visible`; no session is seeded here.

## Not asserted, because no criterion says so

- A warning on a channel's card, in `deep inbox` or in a notification. The Scope puts it on the authority card.
- The warning's words, its place on the card, its translation, and that `en.json` holds it (the copy lint's task).
- #1464's check itself, and any row of the safety list but #1583's.
- A plan's steps on a channel's card (`plan.steps`, carried beside the plan's hash), a path, and a command on a
  channel. The Scope's last line leaves a channel's summary.
- The control characters #1510 covers (ESC, CR, newlines), the other marked characters, and where a summary is cut.
- How a URL's host is shown, and `deepbuild://` links, whose targets the hub writes itself.
- The chat, email and text channels: they take the same `summaryOf`, and text carries no summary.
- A session's name on a channel, where none is drawn, and in `deep status`.
- That the hub's own `deep_ask` path keeps the bytes. The asks are raised through the asks core, as #1510's.
- Whether a signature over the shown card saves a decision, and an authority ask's yes from the phone: #65, #1580.

## What the implementer adds outside this folder

1. In `crates/deep-app/Cargo.toml`, with the other acceptance targets:

   ```toml
   # Issue #1583: the question card's text and a session's name, printed for tests/acceptance/1583/app.test.ts, which
   # judges them; written blind in tests/acceptance/1583. No libtest harness: it draws what it is given.
   [[test]]
   name = "acceptance_1583"
   path = "../../tests/acceptance/1583/app/card.rs"
   harness = false
   ```
2. `crates/deep-app/safety.json`, with the warning's row for `#1583`, as above.
3. The planted card `card-draws-raw`, read through `deep_app::plain::planted`, as above.

Nothing else: the lane file is here, and no lane list, ceiling or hub plant list needs a line.

## Files

- `texts.ts`: the characters and every fixture text.
- `judge.ts`: the judges.
- `helpers.ts`: the hub's world, the phone's signature, `deep` with its stdout as bytes, the record reads. It imports
  what #1580's helpers import for the same things: `../16/helpers.ts`, `../34/helpers.ts`,
  `../65/fixtures/providers.ts`, `../65/helpers.ts`, `../65/redraft-1579/helpers.ts` and its `fixtures/phone.ts`.
- `channel.test.ts`: AC1, AC3, AC4, AC5 on a channel's card, in `deep inbox` and in the record.
- `app.test.ts`: AC1, AC2, AC4 in the app's card, and the planted card. It imports `../16/helpers.ts`.
- `app/card.rs`: the target `app.test.ts` builds and runs.
- `twins.json`, `twins/card-draws-raw/lines.json`: the planted card for the proof lanes.
- `lane.json`: the suite runs alone.
- `tsconfig.json`: #1510's.
- `BASE-FAILURE.txt`: the base run.

## How far these tests were checked

- **Type check**: `tsc -p tests/acceptance/1583/tsconfig.json` exits 0 on the built base.
- **On the base** (`BASE-FAILURE.txt`), each file run once: 13 tests. The 7 tests of new behaviour fail, each at its
  own assertion after its setup held: the hub started, the paseo channel installed, each of the five asks' cards
  reached the relay, `deep inbox` exited 0, the phone's signed answer was read, the target built and all 15 cards
  presented. The 6 tests of behaviour that must not change pass. No test or fixture needed a correction after the run.
- **The planted card on the base.** The base was built twice with the `[[test]]` entry: as it is, and with
  `question.rs` changed at the one place above. `app.test.ts` ran on the second, where the planted card's test
  passes: the card draws the three characters raw and the check names each. On the first, the built target was run
  directly on this file's cards and judged by `judge.ts`: with the plant's name set it draws the card as without it,
  the check finds nothing, and the planted card's test's assertion fails. `app.test.ts` itself was not run on the
  first, since its own cargo step builds whatever the checkout holds. With no plant set the two builds draw the same
  lines of every card.
- **The judges** were each run against planted inputs with plain `node`: good inputs made with the base's own
  `visible` and `typed` pass; a raw, a stripped and a differently spelled input each fail, naming the character; a
  card with a warning line, one without, one that warns always and one that draws the character raw are told apart;
  the safety list's missing, broken and well-formed forms are read as such.
- **The twin**'s one edit applies to the base's `plain.rs` at exactly one place. It was not built or run.
- **Lints**: `scripts/wait-ratchet.mjs` passes, and neither it, `scripts/twins-lint.mjs` nor
  `scripts/repo-rules.mjs`, run with cargo on `PATH`, prints a line naming this folder. The repo rules exit 1 on the
  base all the same, on five `deps` lines about `crates/deep-show` and `tests/acceptance/2700`. `app/card.rs` passes
  `rustfmt --edition 2021 --check`.
- **Not run**: anything against an implementation of #1583, since none exists. So the passing side of each failing
  test is untried, and so is everything after its first failing assertion: the refusal naming `card_hash`, the
  signature over the card as shown counting, a warning line matched against a safety row, and the planted card
  reached by the plant's name in an implementation's own code.
