# Criterion 9, blind redraft

Criterion 9 of #317 (`#317.80848a53`): "With the hub stopped and with it up, an agent's `deep restore ~/backup`,
directly and through `sh -c`, `nohup` and a heredoc, is denied, naming the command for you to run, while its twins
`git restore src/cart.ts` and `deep status` are allowed; a deep-hook without that entry lets the call through, which
from R2 (#572) puts an older record back over the verdicts and decisions made since, and fails this test, naming the
call"

Redrafted blind from the issue's body (no comments), `docs/technical-design.md` at the base (Before each command
through Threats, and what stops each one, with the bullets "Destructive commands you approved" and "Discarded edits
are destructive too"; Hook protocol (deep-hook and the hub); the Backups and writer-generation lines on `deep
restore`), AGENTS.md's Proof rules, `../README.md`, `../helpers.ts` (imported unchanged) and the entries of
`crates/deep-hook/default-rules.json`, at base commit `96b462a6` (origin/main). No implementation under
`crates/deep-hook/src` and no other test of this suite was read. `plan.test.ts` here is this criterion's test.

## Run

```sh
npm run build --workspaces               # twice if the first build after install fails
cargo build --locked -q -p deep-hook
node node_modules/typescript/bin/tsc -p tests/acceptance/317/tsconfig.json   # its include covers this folder
npx vitest run --root tests/acceptance/317 --no-file-parallelism redraft-ac9
```

As `../README.md`: every process gets a temp `HOME` under `/tmp/dh317-*`, no planted call is ever run, and the
suite stops only the processes it started, by PID.

## Tests

| Test | Checks |
|---|---|
| `AC9 … with the hub stopped: …` | With the defaults installed and no hub, in a clean checkout where `src/cart.ts` is tracked: `deep restore ~/backup` as written, as `sh -c '…'`, `nohup …` and `sh <<'EOF' … EOF` is each denied, carrying a shipped entry's `reason` and `next_step` and naming `deep restore ~/backup` (with `~/` read as the home folder, `../helpers.ts` `names`); `deep status` is allowed; `git restore src/cart.ts` as below |
| `AC9 … with the hub up: …` | The same with a real installed hub (`deep hub run`, same `rules.json`); both twins allowed outright |
| `AC9 … a deep-hook without the \`deep restore\` entry …` | The wrong program, built as data as `../README.md` builds every one (`without`): the defaults less each entry that, installed alone with the hub stopped, denies `deep restore ~/backup`. With the hub stopped and with it up, it allows the call, and the first two tests' check run against it fails with "`deep restore ~/backup` with the hub … must be denied". If no shipped entry holds the call, the wrong program can't be made and all three tests fail |

## Where the criterion and the design differ

The criterion lists `git restore src/cart.ts` as a twin allowed with the hub stopped. The design's "Discarded edits
are destructive too" counts "a checkout or restore of paths" as discarding uncommitted edits and says "With the hub
down it's denied, and the denial names the command for you to run, since nothing can read the tree or stage it"; the
defaults ship that as its own entry. Read together, the twin exists to show that the `deep restore` entry doesn't
catch `git restore`; it can't overrule the discard floor. So with the hub stopped the test:

- installs only the entries that hold `deep restore ~/backup` and requires `git restore src/cart.ts` allowed;
- with every default installed, accepts `git restore src/cart.ts` allowed, or denied only in the words (`reason` and
  `next_step`) of an entry other than those, and fails it denied in a `deep restore` entry's words or in no entry's.

With the hub up the tree is clean ("On a clean tree there's nothing to lose, so it runs with no copy and no ask"),
so `git restore src/cart.ts` must be allowed outright, as the criterion says.

The criterion's "which from R2 (#572) puts an older record back" is what the wrong program would cost, not
something this test can run: `deep restore` is R2's.
