# #806 proof: the suite on the implementation

`PROOF-RUN.txt` is the whole suite run once, opted in to the live sessions, on the reference MacBook Air (Mac15,12):

```sh
DEEP_SHOW_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<the maintainer's sign-in> NO_COLOR=1 \
  npx vitest run --root tests/acceptance/806 --no-file-parallelism --reporter=verbose
```

26 of 26 pass: the 13 replays of #393's and #384's scenarios against the hub and the app (AC1), the fast and the live
Claude Code and Codex sessions (AC2, `claude` 2.1.314 on `-p`, `codex-cli` 0.144.0 on its ChatGPT sign-in copied into
the temporary home), the unbound call (AC3), and the app closed (AC4). Token and home paths are redacted.

## Wrong programs the suite was run against, each failing as its criterion names

Besides the two plants the criteria name (`deep-show-writer-from-payload` and `deep-show-waits-for-app`, which the
suite selects itself), the implementation was changed by hand, built, run against the files named, and put back:

| Mutant | Files | Result |
|---|---|---|
| deep_show stamped as the hub's first session, whatever the binding | `sessions.test.ts` | 2 of 6 fail, naming the layer |
| an unbound deep_show bound to the first session | `unbound.test.ts` | AC3 fails: presented, not refused |
| no doc.patched@2 recorded | `sessions.test.ts` | 4 of 6 fail: the record holds no revision by hash |
| every deep_show 3.2 s late | `closed.test.ts`, `replay393.test.ts` (hidden) | both fail on the 2 s bound |

The base fails every test (`BASE-FAILURE.txt`).
