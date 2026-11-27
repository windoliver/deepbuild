# Twins for the 3428 tests

No implementation existed when these tests were drafted. Each twin is the merged implementation with exactly one rule
broken, and nothing else changed. One twin is planted here as a file, `range-left-at-0.16/`, laid over the repo as it
stands (the base's `packages/paseo/paseo-plugin.json`, whole). The others are hub or setup behaviors: the implementer
adds each as a value of `DEEP_HUB_PLANT` in `packages/hub/src/plant.ts`, the one place the hub, setup and the doctor
read their planted wrong programs, and the tests reach it because #27's `childEnv` passes `DEEP_HUB_PLANT` to every
`deep` they run (`DEEP_HUB_PLANT=<name> sh scripts/lease … vitest … --root tests/acceptance/3428`). `facts-ahead-of-run`
is a facts edit.

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and what its message names | Fails on the merge base too? |
|---|---|---|---|---|---|
| `#3428.c21bc24c` | `range-left-at-0.16` | `packages/paseo/paseo-plugin.json` (planted here) | The facts gain the newest release and the plugin's range stays `>=0.15.0 <0.16.0` | `real.test.ts`, the facts and the range: "the plugin's requirements.paseo (>=0.15.0 <0.16.0 …) holds 0.17.6" | Yes, one assertion earlier: the base's facts end at 0.15.0 |
| `#3428.c21bc24c` | `facts-ahead-of-run` | `adapters/paseo.facts.json` and the range | The facts and the range name 0.17.6 with no run behind them (the Scope's "nothing widens the range ahead of one"), and the plugin's code fails on that daemon | `real.test.ts`, #55's real-daemon cases on a real 0.17.6: the failing case by name. The facts half passes on it, which is why the daemon half exists | The base reads BLOCKED there (the facts name 0.15.0) |
| `#3428.ffe37f29` | `installs-any-version` | `packages/hub/src/plant.ts` (setup) | Setup installs whatever paseo runs, as the merge base does | `setup.test.ts`, newer paseo: "deep setup must run no paseo plugin install; it ran paseo plugin install npm:…, and said of paseo […]", naming the daemon line | Yes: it is the merge base's behavior |
| `#3428.ffe37f29` | `says-no-versions` | `packages/hub/src/plant.ts` (setup) | Setup refuses the newer paseo, and its line names neither paseo's version nor the versions covered | `setup.test.ts`, newer paseo: "one line of deep setup names paseo's version … and the versions its facts cover" | No: the base fails the first assertion |
| `#3428.ffe37f29`, `#3428.53c885f5` | `refuses-every-version` | `packages/hub/src/plant.ts` (setup) | Setup installs on no paseo at all, covered or not, or takes every source for one that doesn't resolve | `setup.test.ts`, the other side of the line: "on paseo <newest covered>, which the facts cover, deep setup runs paseo plugin install npm:… once" | No: the base installs |
| `#3428.25c11692` | `listed-is-set-up` | `packages/hub/src/plant.ts` (setup) | Setup takes a plugin paseo lists as set up, whatever its state, as the merge base does | `setup.test.ts`, refused at load: "paseo … lists deepbuild with status failed … deep setup must not report paseo as set up" | Yes |
| `#3428.25c11692` | `plugin-item-warns` | `packages/hub/src/plant.ts` (doctor) | The plugin's item reads warn, not fail, for a plugin paseo refused | `doctor.test.ts`, refused at load: "the plugin's item reads at its error level, fail" | No: the base has no item |
| `#3428.25c11692` | `reason-dropped` | `packages/hub/src/plant.ts` (doctor) | The plugin's item reads fail and says the plugin isn't loaded, without paseo's reason | `doctor.test.ts`, refused at load: "the plugin's failed item says paseo's reason" | No: the base has no item |
| `#3428.cfb1bd37` | `source-from-npmjs` | `packages/hub/src/plant.ts` (doctor) | The source item asks registry.npmjs.org, not npm's configured registry, so a source that resolves for paseo's npm reads failed (and here, with no network, it never resolves) | `doctor.test.ts`, covered paseo: "every paseo item reads ok", naming the source item | No: the base has no item |
| `#3428.cfb1bd37` | `items-without-paseo` | `packages/hub/src/plant.ts` (doctor) | paseo's items are listed whenever `~/.paseo` exists, paseo on the PATH or not | `doctor.test.ts`, no paseo on the PATH: "there is no paseo item", listing them | No: the base lists no paseo item anywhere, and reads BLOCKED there for the missing covered release |
| `#3428.53c885f5` | `edits-config-first` | `packages/hub/src/plant.ts` (setup) | Setup hands the source to `paseo plugin install` before checking it, as the merge base does | `source.test.ts`: "deep setup handed paseo's ~/.paseo/config.json to paseo plugin install before checking the source" | Yes |
| `#3428.53c885f5` | `source-unnamed` | `packages/hub/src/plant.ts` (setup) | Setup stops on a source that answers 404 and writes nothing, without naming the source | `source.test.ts`: "deep setup names npm:@deepbuild/paseo@… as answering 404" | No: the base fails the first assertion |
| `#3428.53c885f5` | `undo-removes-anyway` | `packages/hub/src/plant.ts` (undo) | `deep setup --undo` runs `paseo plugin remove deepbuild` and writes config.json back though setup installed nothing | `source.test.ts`: "deep setup --undo after a setup that wrote nothing of paseo's runs no paseo command that changes it" | The base fails earlier, at setup's install |

None of these twins was run against an implementation, since none exists. What ran on the merge base, a wrong program
for every new-behavior test here, is in `../BASE-FAILURE.txt`.
