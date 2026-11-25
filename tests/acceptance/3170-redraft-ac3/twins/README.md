# The twin for #3170's third criterion

The criterion says "as today", so its test passes on the base. This is the planted wrong program it fails on. It is
the base's file with only the fault planted, and replaces the one file its path names, which is outside the test
paths and `node_modules`. A copy goes stale as that file changes, and still holds its fault. `../twins.json` names it.

| Criterion | Twin | Replaces | The planted fault | Fails on |
|---|---|---|---|---|
| `#3170.618b6b1f` (AC3) | `forced-cow-folder` | `.cargo/config.toml` | The first criterion done the wrong way: a Linux target runner, `env DEEP_TEST_COW_DIR=/srv/deep-cow`, names the Spark's copy-on-write folder to every test binary cargo runs on every Linux machine, over the folder that machine names. On a Linux machine without `/srv/deep-cow` the cli test can't make it (`/srv` is root's) and panics with `Permission denied`, not BLOCKED and the fix | Linux without `/srv/deep-cow` (the Spark) |

The fault reaches the cli test only as cargo runs it; no Rust code changes. If a change also teaches the cli test to
read a missing folder as BLOCKED, the twin still fails the test's last assertion: that BLOCKED names `/srv/deep-cow`,
not the folder the machine offered. (Reasoned, not run: no such change was at hand.)

The fault isn't an `[env]` entry with `force = true`, the likelier spelling, because on the Spark cargo refuses to
merge that table with the plain string the Spark's own `~/.cargo/config.toml` gives the same key, so the run never
reaches the test (`../BASE-FAILURE.txt`). A runner sets the same variable for the test binary, and no user config here
sets one.

To run it: in a throwaway copy of the base with this suite in it, copy `forced-cow-folder/.cargo/config.toml` over
`.cargo/config.toml` and run `../blocked.test.mjs`. `../BASE-FAILURE.txt` holds the run.
