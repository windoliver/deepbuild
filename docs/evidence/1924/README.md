# #1924 proof

These are the blind suite's proof files (`tests/acceptance/1924/`, run with `--no-file-parallelism` on macOS arm64, Node 24.22.0) from the run on the branch's committed tree, whose base is main at `d51be2c3`. 6 of 6 tests passed. Every hub, plug-in and agent stand-in ran under `/tmp/dh1924-*` with a temp `HOME`. The test hosts were HTTP servers on 127.0.0.1 in the test process, nothing left the machine, and no model was called.

The issue's Proof, the hosted tool's one ask, is `seen.held` in `ac1-hosted-clean.json`.

| File | What it shows |
|---|---|
| `ac1-hosted-clean.json` | `hosted-a@1.0.0` given the agent's attached `notes.txt` by hash is held twice on one authority ask naming the file's SHA-256 and `127.0.0.1:<port A>`, and host A gets no request. After your yes the run is done, host A gets the file once, and the receipt's `sent` lists `{sha256, host A}`. A second job of that pair (`{case: lower}`) runs with no ask. The same file to `hosted-b@1.0.0` is held on a new ask naming host B, which gets nothing. The render DeepBuild made goes to host B with no ask, listed in its receipt. An input naming the path of `draft.txt`, and of a missing file, gets the same refusal, with nothing read, stored, sent or asked. |
| `ac1-hosted-job-host-asks-again.json` | The hub that keeps your yes for one job only asks again on the second job of the approved pair, and the judge fails it naming `hosted-a@1.0.0` and the file's hash. |
| `ac1-hosted-job-host-sends-early.json` | The hub that sends before your answer gets requests holding the agent's file at host A before the yes, and the judge fails it naming the job. |
| `ac2-weights-clean.json` | `open-a@1.0.0` declares `model.safetensors` and `tokenizer.json` by hash and needs `fp16`. With both files and `fp16` reported, the run is done with one call, and its receipt names both weight hashes. With `model.safetensors` swapped on the host, the run is BLOCKED with an unblock ask naming the file, and no call is made. With `fp16` missing, it is BLOCKED with an unblock ask naming `fp16`, and no call is made. `test/open-model@1.0.1`, declaring the same `open-a@1.0.0` with a new hash for `model.safetensors`, installs, and the first job misses the cache, calls once and names the new hash. |
| `ac2-weights-job-weights-call-anyway.json` | The runner that calls whatever the host reports calls on both mismatches, and the judge fails it naming `open-a@1.0.0` and the input's hash. |
| `ac2-weights-job-weights-not-keyed.json` | The runner whose key leaves out the weight hashes serves the earlier output after the new declaration, and the judge fails it naming the job. |
