# #1731 proof

The blind suite's proof files (`tests/acceptance/1731/`, run with `--no-file-parallelism` on macOS, Node 24.22.0) from
the run at the merge of main into the branch: 8 of 8 tests passed. Every request, ask, row and file is the fixture
library's ("Shelf" on 127.0.0.1); nothing left the machine.

| File | What it shows |
|---|---|
| `ac1-search.json` | The search's rows (the 9 chairs in [0.4, 1.2] m, ranked) and the library's request log for it: the search API and thumbnails, no file |
| `ac1-planted-measures-by-download.json` | The planted fill that downloads each hit failing, naming the request log |
| `ac2-ask.json`, `ac2-fetched.json`, `ac2-store.json`, `ac2-show.json` | The one authority ask (library, 1292 bytes, CC-BY-4.0), the fetch after the yes, the stored file with its license and upstream URL, and the asset.game@1 item naming it with CC-BY-4.0 |
| `ac2-rule-refusal.json` | Under the CC0-only standing rule, the CC-BY fetch refused naming CC-BY-4.0, after one record read and no file |
| `ac3-unknown.json`, `ac3-show.json` | The unknown-license model BLOCKED with one unblock ask and nothing fetched, and the item naming it refused |
| `ac3-planted-reports-cc0.json` | The planted fill that reports it as CC0 failing, naming the row and the library's own record |
| `ac4-off.json` | With the library off: no library rows, the fetch refused naming it, no request to it |
| `ac5-offline-search.json`, `ac5-offline-fetch.json` | Offline: the same rows from the cache, stale with their age, and two fetches BLOCKED with one unblock ask |
