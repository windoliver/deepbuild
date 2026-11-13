# #1942 proof

These are the proof files of the blind suite (`tests/acceptance/1942/`), from one run on the merge of main into the branch. It ran with `--no-file-parallelism` on macOS arm64 (Mac17,10) with Node 24.22.0, against this Mac's Lima VMs `deep-ubuntu` and `deep-fedora` through the suite's relay. 8 tests passed. AC3's two timings were skipped as INCONCLUSIVE: the load was 150–170 on 18 cores and the thermal state was "fair". The VM's user name and key paths are redacted, and run tokens are cut to 8 characters except in AC2's unit names and where a failure names one, each for a run that has ended.

| File | What it shows |
|---|---|
| `ac1-unnamed.json` | `host.list` names only `dh-ubuntu`. `dh1942-stranger`, `127.0.0.1` and `ssh://dh@127.0.0.1:<port>` are each refused by name, with 0 connections to the listener behind `Host *`. |
| `ac2-midway.json`, `ac2-end.json` | **The issue's Proof:** a remote run's output on a real host, by its run token. An agent's `deep_run` starts a 40 MiB download on `dh-fedora` as the user unit `deep-<token>`. 15 s after the session ended, that unit is active and the download is growing, with no `run.finished` and no verdict. It ends `passed`, and its stdout evidence `4af170d0…` is the download's output, whole. |
| `ac3-*.json` | Facts refresh over SSH: 147–220 ms against 5 s. Remote output lag, worst line per window: 63–74 ms against 500 ms. Both are INCONCLUSIVE by the lane's rule (load and thermal state). |
| `ac4-stall.json`, `ac4-plant-drops-every-connection.json` | During A's 60 s stall, B's 560 lines arrived with a worst lag of 69 ms, none late, and B's connection never closed. A came back on a new connection 5.2 s in. The planted link drops B with A, and the judge names B's run as reconnected. |
| `ac5-once.json`, `ac5-plant-resends-on-reconnect.json` | One connection was cut right after the start landed. The start was read back by its token: 1 start on the host, 1 `run.started`, ended `passed` with the ticks once. The planted resend starts it twice, and the judge names the token. |
