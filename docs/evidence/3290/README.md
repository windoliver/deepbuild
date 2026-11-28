# Evidence for #3290: the before lane reads #1333's twins.json

Each run is the real `node scripts/proof.mjs before` in a fresh GitHub clone on the MacBook Pro (Mac18,1), Node 24.22.0,
2026-11-26. The lane proves the issue its change names, so each clone carries one scratch commit on main `35956a44a`
whose message says `Part of #1333`: an empty one for main as it is, and one holding the redraft's tree (`0682aed8d`'s).
`BAY` and `BUILD` lines are left out of the lane files.

| File | What it shows |
|---|---|
| `before-lane-main.txt` | Main: all 6 tagged tests of #1333 read BLOCKED on `must map each criterion tag to a list of twin folder names`, and no twin is laid. 654 s, load 28 |
| `before-lane-redraft.txt` | The redraft: the refusal is gone, the 15 named twins are laid, and each of the 6 tagged tests fails on a twin of its own criterion at its assertion. 2,401 s, load 26 to 15 |
| `keys-and-folders.txt` | Each key of the redrafted file with the test file that carries it, and each name with its folder under `twins/` |
| `lint-main.txt` | `node scripts/twins-lint.mjs` on main lists `tests/acceptance/1333/twins.json` |
| `lint-redraft.txt` | On the redraft it no longer does. The 15 `holds a whole file` lines are #3291's |
