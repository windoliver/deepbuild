# #1606 AC5 and AC9, redrafted to run with no window

Written blind by the job that wrote `tests/acceptance/1606/`, which still has never seen an implementation of #1606.
The inputs are the same: the issue, the design and the base commit `1c4d1f0e2`. This folder adds files; it changes
none in `1606/`. The owner asked for the redraft on November 12, 2026, to close the issue where it was blocked.

## Why

`1606/device.test.ts` proves AC5 and AC9 by pressing the card in the real app's window from outside its process
(#1454's probe), which needs Accessibility and Screen Recording for the process running the tests. The Macs this
project's agents run on have neither, so those tests read BLOCKED there, never PASS. Nothing outside the app can
press its window without those permissions.

This draft answers the same card without the window, the way the replica drives it (`crates/deep-replica`). The
card's own controller (`deep_app::question::Controller`) is presented from the hub's record, and its option is pressed
by an accessibility action once it armed. The OS is asked through the app's own `answer::confirm` (the `test-confirm`
stand-in), and what the card wrote is sent by the app's own `answer::send`, which signs it as the app's device and
pairs one first when the app has none. These are the steps `card.rs` takes after a press. GPUI's drawing and the
platform's delivery of the click are the only parts left out, and neither keeps or uses the device key.

AC9's move is the real app's, at its start: the real `deep-app` is started on the home, as `1606/stolen.test.ts`
starts it, and needs no permission. `1606/device.test.ts` stays, and still proves more on a Mac that has the
permissions: a press on the drawn card.

## Run

As `1606/README.md` says, then:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1606-redraft-ac5-ac9 --testTimeout=1800000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1606-redraft-ac5-ac9/tsconfig.json
```

It needs no Accessibility or Screen Recording, only a logged-in session for AC9's app start. It reuses
`../1606/helpers.ts`, so the same safety holds: temp homes, stand-ins for the OS store and prompt, and processes stopped
by PID.

## Surface (added to `1606/README.md`'s)

- **A `[[test]]` entry in `crates/deep-app/Cargo.toml`**, which the implementer adds, as #34's, #1510's and #2117's were
  added:

  ```toml
  [[test]]
  name = "acceptance_1606"
  path = "../../tests/acceptance/1606-redraft-ac5-ac9/app/card.rs"
  harness = false
  ```

  `app/card.rs` uses only what the base exports: `question::{Controller, Input, Target, Phase, Did, Faults, CARD_SIZE}`,
  `arming::{Slot, Source, Client}`, `answer::{confirm, send}`, `hub::HubClient` and `views::now`. The test builds it with
  `cargo test --no-run` and the features `test-confirm,test-secrets` (plus `plant-key-in-file` for AC5's wrong
  program), then runs it as `<executable> <ask> <option>` with `HOME` the test's home and `DEEP_APP_TEST_CONFIRM` and
  `DEEP_APP_TEST_SECRETS` set. It prints `{"answered": [...]}` or `{"failed": "..."}`. With no arguments, as in
  `cargo test --workspace`, it answers nothing.
- **The ask** is a seeded choice ask (`deep_ask.choice`). Its card answers with its last option, which is no default,
  and needs the OS's confirmation, since an accessibility action isn't hardware.

## Criteria to tests (`card.test.ts`)

| AC | ID | Test | Wrong program |
|---|---|---|---|
| AC5 | `#1606.1b905924` | the app pairs and its card's answer counts once (one `ask.answered`, the option pressed, `via: card`); then no file under `~/.deepbuild` holds a paired device's private key (`1606`'s judge) | `plant-key-in-file`: a test of its own, which expects the failure to name `~/.deepbuild/app/device.json` |
| AC9 | `#1606.21a4b991` | an older app's key in `device.json`; the real app started and gone again; the file gone within two minutes; the card's answer counts once; no device paired after the move | none named |

## How far this was checked

On the base, with the `[[test]]` entry added in a scratch copy: the card's answer counted, and AC5 failed naming
`<home>/.deepbuild/app/device.json`; AC9 failed with `device.json` still there two minutes after the app started; the
plant read BLOCKED (`BASE-FAILURE.txt`). Against a throwaway app change, since reverted, that kept the key in the
`test-secrets` store and moved an older file there at the app's start, all three passed (`BASE-FAILURE.txt`, last
section). Never run against an implementation of #1606.
