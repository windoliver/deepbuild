# Twins for the AC3 redraft

AC3 says "as today", so its tests pass on the base, `74e6e263`, and `../twins.json` names the wrong programs they fail
on instead. Each twin is the base's `crates/deep-hook/src/main.rs` with one place in `forward` changed: the `Err` arm
that, when `rules.json` can't be read, sets the denial deep-hook prints with the hub away. Nothing else differs, and no
test file is laid. The blind job wrote both, with the tests.

| Twin | The wrong program | Lines changed | Where the tests fail |
|---|---|---|---|
| `away-denial-dropped` | The arm is emptied (`Err(_) => {}`): an unreadable `rules.json` is denied only from the hub's reply, as a fix for AC1 and AC2 could leave it, so with the hub stopped deep-hook reads no entry and the call runs, every guard off | 5 lines become 1 | Both tests, at "must be denied" |
| `away-denial-unnamed` | The arm still denies, in other words: "DeepBuild blocked this: deep-hook can't check its guards while the hub doesn't answer. Retry it.", naming neither `rules.json` nor why | 2 | Both tests, at "names rules.json" and at what it says of the file |

To run one by hand: copy its `crates/deep-hook/src/main.rs` over the checkout's, run the suite (it builds deep-hook),
then put the base's file back (`git checkout -- crates/deep-hook/src/main.rs`) and build again. `../README.md` has the
results.
