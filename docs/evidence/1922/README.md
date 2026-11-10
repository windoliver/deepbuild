# #1922 proof

These are the blind suite's proof files (`tests/acceptance/1922/`, run with `--no-file-parallelism` on macOS arm64, Node 24.22.0) from the run on the merge of main into the branch. 15 of 15 tests passed. Every hub, plug-in and tool ran under `/tmp/dh1922-*` with a temp `HOME`. Nothing left 127.0.0.1, and no model was called.

| File | What it shows |
|---|---|
| `ac1-pinned.json` | Runs naming no tool, `upper-a`, `upper-a@1`, `upper-a@^1.0.0`, `upper-a@latest` or `upper-a@2.0.0` are each refused and start 0 processes. The pinned `upper-a@1.0.0` runs "abc" to "ABC" and starts 1 process. |
| `ac1-paid-held.json`, `ac1-paid-yes.json`, `ac1-paid-rule.json` | The paid `upper-paid@1.0.0` is held twice with one authority ask naming it and $0.02, and starts no process. After your yes it runs once. After `job.rule` it runs "xyz" with no ask. |
| `ac2-list.json`, `ac2-run.json`, `ac2-rerun.json` | The list shows `test.upper` held by `test/upper-kind` with `upper-a@1.0.0` and its build. The run returns SHA-256("ABC") with a receipt (kind, tool, key, build, cache miss) and starts 1 process. The rerun is a hit under the same key and starts 0. |
| `ac3-tools.json`, `ac3-planted-lowlast.json` | `upper-b@1.0.0` (test/upper-more) is listed beside `upper-a@1.0.0`. The planted lowercase-last-letter tool is refused at install naming `fx-greeting`, and is listed under no kind. |
| `ac4-rival.json`, `ac4-heir.json`, `ac4-check.json` | The second registration is refused naming `test.upper` and `test/upper-kind`. `test/upper-heir` (replaces) installs and holds the kind. The "lower" run fails naming `test.upper_only`, with no output and SHA-256("abc") not stored. |
| `ac5-key.json` and both `ac5-key-planted-*` files | Changes that must miss all miss (3 of 3), and changes that must hit all hit (5 of 5). The params-text plant fails on the reordered and omitted cases, and the no-version plant fails on the bump. |
| `ac6-rebuild.json`, `ac6-planted-job-build-entry-only.json` | The same-version rebuild is refused naming `upper-b@1.0.0` and both builds, and the hit is kept. `upper-b@1.0.1` joins and misses once. The entry-only host accepts the rebuild, and the judge names `tool/case.mjs`. |
| `ac7-build.json` and both `ac7-planted-*` files | The receipt's build is `packageDigest(<plug-in>/tool)`, and two install folders record one build. The paths and mtimes hosts record two builds, and each failure names `upper-b@1.0.0`. |
