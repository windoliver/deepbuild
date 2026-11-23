# Blind redraft of #3234's criteria 3 and 4: the words go through the box

Written blind, at base commit `f8c6cff822b5b960d35312d75d44769616a95516` (main), the base the original suite was written
on, from issue #3234, its design sections, the code and tests at that base, the original blind suite
(`tests/acceptance/3234/`, from `8fdd44e87`) and the dispute below. No implementation of #3234, other worktree, branch,
PR or session transcript was read. The implementing agent does not edit these files (AGENTS.md, Proof).

**Criteria** (the issue's third and fourth, verbatim):

- AC3 `#3234.c875f23b`: "With one of four pictures never shown, Send back with words is accepted and reaches the agent
  once. A planted card that refuses it fails, naming the ask".
- AC4 `#3234.38958545`: "The answer's record holds four entries, each with shown, the largest scale and the
  milliseconds on screen, equal to the replica's trace of what was drawn. A planted recorder that marks every picture
  shown fails, naming the one that never was".

Each ID is the first 8 hex of the SHA-256 of that text, whitespace collapsed (`scripts/proof-change.mjs`,
`criterionId`); every test name starts with `AC3 #3234.c875f23b` or `AC4 #3234.38958545`.

## The dispute

The original `answer.test.ts` typed the words with `act type` and no locator while the keyboard was on the presented
card, from its README's surface 3: "Words are typed where the keyboard is on a presented card (its answer field)". The
merged program and a merged acceptance test say otherwise:

- On an ask's page the card's words are the box at the page's foot (#1461): `crates/deep-app/src/card.rs` `AskPage` ("the
  box at its foot as the card's words"), and `crates/deep-app/src/words.rs`, where the box's `Change` feeds
  `Card::type_words`. #1461's `box.test.ts` AC16 holds that an ask's page has exactly one text field, `box-draft`.
- The card holds the keyboard while it shows (#1462), and `Card::key_down` takes every unmodified key and acts only on
  Tab, the arrows, Esc, Page Up/Down, Home/End, Space/Return and digits: a letter typed on the card does nothing.
- `tests/acceptance/1462/answers.test.ts` AC8 ("A key typed on a question card writes nothing") types letters on the
  armed taste card and requires that they answer nothing, send nothing and leave the box alone. Its AC11 puts words on
  an ask's page as `press 'cmd-n'` (⌘N puts the keyboard in the box, #1462 Pinned 7) then `type`.

So no program passes both #1462 AC8 and the original AC3: words typed on the card must not reach the box, and AC3 needs
them to reach the answer. AC4's clean run is AC3's, so it fails with it. The design's "Typing on the card opens its
answer field" reads, on an ask's page as merged, as that field being the box below the card; the words still answer
only the ask the card shows and go with the option pressed ("With an option, the option decides and the words go with
it as its reason").

## What was read

- `AGENTS.md`; issue #3234; `node scripts/design-section.mjs --issue 3234` (Question card, Sheet, An ask and your answer
  getting back, How we know version 0 works).
- The original suite: `README.md`, `answer.test.ts`, `helpers.ts`, `BASE-FAILURE.txt`, `tsconfig.json`.
- At the base: `crates/deep-app/src/card.rs` (`AskPage`, `let_go`, `Card::key_down`, `Card::type_words`, the card's
  keyboard keeping in `render`), `crates/deep-app/src/words.rs` (`focus`, `type_in`, the box's `Change`, its
  mouse-down `let_go`), `crates/deep-app/src/question.rs` (`Controller::type_words`, `placed`),
  `crates/deep-app/src/arming.rs`, `crates/deep-app/src/actions.json` (⌘N is "Write in the box"), and
  `crates/deep-replica/src/drive/mod.rs` (`act type` and `act press`).
- `tests/acceptance/1462/answers.test.ts` (AC8, AC11) and its README (Pinned 7, Readings 5);
  `tests/acceptance/1461/box.test.ts` and its README's box ids; `tests/acceptance/1808/helpers.ts`'s `Replica`.

## What changed from the original, and why

Only how the words reach the card. In `backRun`, after the premise (three pictures shown, one never drawn whole), the
original did `typeWords` (an `act type` with no locator, on the card). The redraft does:

1. `r.press('cmd-n')`: `act press` with the keys `cmd-n`, which puts the keyboard in the ask's page's box (#1462 AC11).
   A `see` sample follows, added to the trace.
2. `typeWords(r, WORDS)`: the same `act type` with no locator, now landing in the box, which holds the keyboard. A
   `see` sample follows, added to the trace.
3. Send back pressed on the card as before: `act click` on `card-option:send-back` with `source: "hid"`, the trace's end
   interval `{from, to}` read on the replica's clock just before and just after that press, as the original.

The sample after ⌘N keeps Readings 2's rule of one action between two samples, so a picture's on-screen time stays
bounded by the trace. The words-mismatch failure also says where the keyboard was after ⌘N and what the box read, so a
program whose words never reached the box is told apart from a card that dropped them. `typeWords` is reused from
`../3234/helpers.ts`; its comment names the card's answer field, but the act it sends (`act type`, no locator, where the
keyboard is) is exactly #1462 AC11's `type`.

Everything else is the original's, unchanged: the world (three taste asks of four 800 × 700 pictures, `clean`,
`refuses`, `marks`), the words `the footer still overlaps the last row`, the scrolling and arming waits, the hub check
through #1101's signed app connection, the record judge (`recordFailures`: four entries in the manifest's order, `shown`
exactly, `scale` within 0.01, `ms` within the trace's bounds ± 50 ms), the plants `refuses-send-back` and
`marks-all-shown`, and the original README's surfaces 2 to 4 and Readings 2 and 4, but for surface 3's one sentence on
where words are typed, which this folder reads as: words are put in the ask's page's box (`box-draft`) by ⌘N and
`act type`, and go with the option pressed on the card.

Not used: the box's own send control (`box-send`), which on an ask's page sends the words with no option (#1461 AC16).
The criterion is Send back with words, so the option is pressed and the words go with it.

## Criterion to tests

| Criterion | Test | Wrong programs it fails on |
|---|---|---|
| AC3 | `AC3 #3234.c875f23b: …`: three pictures shown, one never; ⌘N, the words typed in the box; Send back pressed: the app sends one answer, `send-back` with the words; the hub takes it, signed as the app signs it, and records it once, from the card (`via: card`) | the base (no picture drawn: the premise); a card that drops the box's words or sends twice; a hub that refuses the answer or records it twice, without the words or from elsewhere |
| AC3 | `AC3 #3234.c875f23b wrong program: …` | `refuses-send-back` (Send back held like the accepting option), naming the ask: `the card for ask:<ULID> ("…") refused Send back with words` |
| AC4 | `AC4 #3234.38958545: …`: the same answer's `ask.answered` holds four entries in the manifest's order, each `shown`, `scale` and `ms` equal to the replica's trace | the base (premise; no entries); entries missing, out of order, or off the trace |
| AC4 | `AC4 #3234.38958545 wrong program: …` | `marks-all-shown`, naming the picture never shown: `marks <sha256> shown, which the replica never drew whole` |

## How to run

As the original (its README, How to run), with this folder as the root:

```sh
npm ci --ignore-scripts && npm run build --workspaces
scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/3234-redraft-ac3 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3234-redraft-ac3/tsconfig.json
```

The replica is #1101's `deep-drive` build (with `env-plants` for the two plant tests), built in a grant of
`scripts/throttle.mjs build`. Every HOME is a temp folder; only processes a test started are stopped, by PID. Like the
original folder, this one starts real hubs and draws in a replica, so it needs an `alone` entry in `scripts/lanes.mjs`
(a macOS lane); the implementer makes that edit. Vitest writes `node_modules/.vite/` under `--root`; delete it before
committing.

## Files

- `answer.test.ts`: AC3 and AC4, imports from `../3234/helpers.ts` only.
- `tsconfig.json`: as the original's, for this folder.
- `BASE-FAILURE.txt`: how each test fails at the base.
