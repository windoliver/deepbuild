# Acceptance tests for #3023: test.gpu closes test.texture@1.mips, so a test-meter deep-gpu seals

Written first and blind, from issue #3023, the design sections it links (canvas primitives: "Registry and seal:
registries" and "Registries and closed lists") and the base commit `e9d73de96`, by a job that never saw a fix; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft.

## Criteria to tests

| Criterion | File | What it proves |
|---|---|---|
| AC1: a test-meter `deep-gpu` opens a live session on a document holding a `test.texture@1` item without the `list_unclosed` seal panic; the `run` call answers, and the five #425 tests get past the seal | `live.test.ts` | Test 1 builds `deep-gpu` with `cargo build --locked --bin deep-gpu --features test-meter` and sends `deep-gpu run` one `live` call on a scene holding a 64 × 64 `test.texture@1` (mips `all`) on Metal: no `list_unclosed` on stderr, exit 0, one answer with `ok`, the call answered (no `code`), the session `s` `live`, its first revision `current`, and every one of its 3 frames reporting the view of `s`. Test 2 sends, 3 frames each, the live calls #425's five tests send: hold's still showpiece on `--backend noop`, then (Metal) climb's and taste's orbiting showpiece and a fresh process's `canonical` render-back and export of it; each answers past the seal. |
| AC2: `test.gpu` seals with the core canvas, and the sealed listing's `test.texture@1.mips` offers `all`, closed for `record`, reopens_if `never: a test module's fixture kind`, instead `nothing` | `seal.rs` | `Registry::new(BuildSet::Full).with(deep_canvas_test_modules::test_gpu()).seal()` is `Ok`, and `Sealed::field_list("test.texture@1.mips")` is, as the listing's JSON, `{list: test.texture@1.mips, entry: test.texture@1, field: mips, words: [all], closure: {closed: record, reopens_if: "never: a test module's fixture kind", instead: nothing}}`, and its `Closure` equals `Closure::closed("record", "never: a test module's fixture kind", "nothing")`. No GPU. |

The test-meter build seals its canvas modules once per process, as a live call opens its window (`sealed()` in
`crates/deep-gpu-layer/src/live.rs`), whatever the document holds, so test 2 reaches the same seal #425's five tests
reach (`climb.test.ts` AC4 ×2, `hold.test.ts` AC5 ×2, `redraft/taste.test.ts` AC6) with a few frames instead of their
hundreds. Whether those five tests then pass is suite 425's own business; to read that they get past the seal, run
them and check that no failure names `list_unclosed`:

```sh
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run tests/acceptance/425/climb.test.ts tests/acceptance/425/hold.test.ts tests/acceptance/425/redraft/taste.test.ts --no-file-parallelism --testTimeout=600000
```

(`taste.test.ts` writes into `docs/evidence/425/`; this suite doesn't run it.)

## Run them

```sh
# AC2, fast, no GPU (from the checkout root)
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease nice -n 10 cargo test --locked -p deep-canvas-test-modules --test acceptance_3023 --no-fail-fast

# AC1: builds deep-gpu --features test-meter itself (prebuild it the same way to keep the build leased)
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease nice -n 10 cargo build --locked --bin deep-gpu --features test-meter
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run tests/acceptance/3023/ --testTimeout=600000

# types
node node_modules/typescript/bin/tsc -p tests/acceptance/3023/tsconfig.json
```

`seal.rs` is wired as `[[test]] acceptance_3023` in `crates/deep-canvas-test-modules/Cargo.toml`, the one edit this
suite makes outside its folder. `live.test.ts` builds `deep-gpu`, as #379's and #425's suites do, so it runs alone:
`scripts/lanes.mjs` needs `'tests/acceptance/3023/'` in its `alone` list beside `'tests/acceptance/425/'`; this README
is the instruction, the implementer makes that edit.

Off macOS, test 1 and the Metal half of test 2 fail with a message starting `INCONCLUSIVE:`, never pass; the noop half
of test 2 runs on every platform. Nothing here times anything, so nothing needs a reference Mac.

## At the base

`BASE-FAILURE.txt` holds each command and its failing output at `e9d73de96`: AC2's seal refuses with `list_unclosed`,
naming `test.texture@1` and `mips`; AC1's `deep-gpu run` panics at `the live build's canvas modules seal` with the same
`list_unclosed`.
