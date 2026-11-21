# #1898 hand e2e (Nov 20, 2026)

`e2e.command` (open it in Terminal.app, or run it with bash) runs `e2e.test.ts` with the repo's vitest
(`vitest.e2e.mjs`) and prints what it saw. It needs the repo built (`npm run build --workspaces`) and
`target/debug/deep-hook` (`cargo build -p deep-hook`), and Node 24.22.0 from nvm (`.node-version`), which `e2e.command` puts on
its PATH. Nothing in it stands in for DeepBuild: it reuses the #322/#1537
acceptance world (a temp home and repo, a Claude Code session driven through the real deep-hook, recorded GitHub
answers, a fake second-model reviewer that finds nothing) and #68's order endpoint.

1. It starts a real dev hub (`deep hub run`) with a loader hook (`--import`) that logs every module each thread loads,
   and checks that no check kit (checks-command, -numbers, -review, -work) or conformance module is loaded by ready + 5 s, nor after a session starts and its
   definition locks.
2. The session fixes the auth middleware, writes a correct q3 report, opens PR 21 and stops, stating the suite's test
   count (398) with the query behind it. Its definition names a check of every work kind (document, data, message,
   service), so the one claim runs a check of every kind the hub holds: command (the spec's unit check, R1's drafted
   check), review (a runner job), numbers, document, data, message and service. The driver checks each kit's first
   module loads only after the claim, every run passes, and the verdict is PASS, then lists `checks.kinds`.
3. It runs `deep lease -- /bin/echo 'leased run'` against that hub with the same loader log, and checks that it ran
   through `@deepbuild/hub/lease` (`dist/heavy.js`) and loaded neither `yaml` nor `better-sqlite3`.
4. It stops the hub it started (by its PID) and the endpoint, and removes the temp folders.

Each OK line is a check that fails the run: every run on the claim passed, and each kind's own run is named and
passed; the review's runner job finished; each kit's first module loaded at or after the moment the session stopped
with its claim; the verdict is PASS; and the lease printed its line. A run that stops after the hub is ready prints a FAIL line; one that fails before (setup, or a hub that
never gets ready) ends with vitest's own failure and no RESULT line.

`e2e.png` is Terminal.app's window after the run, with its title bar cropped off, and `e2e.txt` is the same report as
text. The header names the commit it ran at, on a clean tree: the one before the commit that adds these two files.
The only change to the driver since is the removal of a redundant `chmodSync` (the file was already written mode 755). Every line is OK, the
claim is PASS, and vitest exits 0.

The service check names its endpoint as `http://127.0.0.1:<port>`. A first try with `http://localhost:<port>` (as #68's
tests use it, when they run the kit directly) failed inside the hub's check run with `getaddrinfo ENOTFOUND localhost`.
That is outside #1898 and is noted in the PR.
