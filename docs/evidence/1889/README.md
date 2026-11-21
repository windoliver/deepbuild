# #1889 by hand: one reply, whatever Gmail answers the sent check

Run on 2026-11-20, macOS arm64, Node 24.22.0, under heavy load (about 90–150). Only a local stand-in Gmail was used;
nothing reached the real Gmail API and no real email was sent.

## What runs

- `scripts/standin.mjs`: a stand-in Gmail, an HTTP server on 127.0.0.1 answering the Gmail v1 paths the shipped
  source uses. It keeps the first send's reply (or drops it, by case), then cuts the connection so the hub gets no
  answer. Each case then answers `find`'s message read its own way. It logs every request.
- `scripts/drive.mjs`: the hub's own pieces from the built `dist` (record, evidence store, asks core, supervisor,
  project trust, extension host). The shipped `packages/sources/gmail` is installed, checked and loaded in its own
  supervised process, with a test token entered on the trusted path. Its work source is added over `Label_7` under a
  reply rule. A client email arrives, run now makes it a task, a result is delivered, and the hub's delivery timer
  ticks once a second. The host's HTTP client sends `https://gmail.googleapis.com/...` over a real socket to the
  stand-in and refuses any other host.
- `scripts/one.sh` runs one case and stops the stand-in by its own PID. `scripts/all.sh` runs the five cases in turn.

`deep hub run` has no route that adds a work source or delivers a work result, so this drives the extension host,
the part of the hub that delivers, as suite 66 does. The plug-in is a real child process speaking to the host.

## Results

| Case | Find's message read | Base `ee05e7257` | Fix |
|---|---|---|---|
| read-503 | 503 three times, then 200 | **2 replies kept** | 1 reply, held 3 reads, then sent (marker found) |
| read-timeout | no answer twice (20 s each), then 200 | 1 | 1 reply, held, then sent (marker found) |
| marker-missing | 200, thread holds no marker | 1 | 1 reply (one resend after "no marker") |
| marker-present | 200, marker in the thread | 1 | 1 reply, sent (marker found), no resend |
| read-404 | 404 once (first send never landed), then 200 | 1 | 1 reply (one resend) |

Logs: `fix.log` (the fix at `c5e811d1e`, as the Terminal panel showed it) and `base.log` (the same scripts on a
fresh clone at the base). The base differs only in the 503 case: there the 503 read as "not sent", so the reply
went out again.

Reading the logs: the first tick's "unknown" row is the claim whose answer was lost, before any `find` has run.
On the base 503 run, three `tried` phases go with two send POSTs because `deliver` reads the message before it
sends: a `tried` whose read got a 503 made no POST.

An agent read the six PNGs and found no error in the fix cases; the only red lines are the base's two replies and
its driver exit 1, which are the bug.

## Screenshots

The Terminal access grant was declined, so these are renders of the Terminal panel's text (the `tee` of the panel's
run, `fix.log`), made with headless Chrome. They are not window captures. Node's notice
"ExperimentalWarning: stripTypeScriptTypes", which the plug-in's process prints as it loads its `index.ts`, is
filtered out of the view by `all.sh`; it is Node's, not this change's.

- `fix-read-503.png`, `fix-read-timeout.png`, `fix-marker-missing.png`, `fix-marker-present.png`, `fix-read-404.png`
- `base-read-503.png`: the bug on the base, two replies kept
