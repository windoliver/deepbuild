# Twins for the 3238 tests

The merge base's `scripts/lease` runs its command with no throttle grant, so every test of the first five criteria
already fails there at its assertion (`../BASE-FAILURE.txt`). The issue's criteria still name planted wrong scripts,
and `../twins.json` names them. Each replaces `scripts/lease` with the blind job's own reference script (the base's,
wrapped in `throttle.mjs build --wait "${DEEP_LEASE_WAIT:-30}"`, through `deep lease` where `deep` is on the PATH or
the CLI is built, the `DEEP_HUB_PLANT` line kept), one rule changed and marked `Planted:`. The reference itself was
never committed.

| Criterion | Twin | What it gets wrong | The test that fails on it |
|---|---|---|---|
| `#3238.52168c75` (AC1) | `runs-directly` | Runs its command directly, as `DEEP_HUB_PLANT=lease-script-runs-directly` does | `serial.test.mjs`: both commands start at once, and the failure names the second |
| `#3238.664c776d` (AC2) | `own-grant` | Unsets `DEEP_THROTTLE`, so it asks for a build grant of its own under an ancestor that holds one | `inherited.test.mjs`: its request waits in the table behind the held slots, and the failure names the job |
| `#3238.4febe21a` (AC3) | `runs-after-wait` | When the throttle gives no grant in the wait (exit 3), runs the command anyway | `no-grant.test.mjs`: the command starts after the `INCONCLUSIVE no grant` line |
