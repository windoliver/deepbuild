# World fix: the stand-in model reads a tunnel's bytes without setEncoding

**What was wrong.** The stand-in model in `helpers.ts` (`Model.start`) read a CONNECT tunnel's bytes by calling
`socket.setEncoding('utf8')` on the socket Node's HTTP server hands its `'connect'` handler. Node 24 refuses that on
such a socket: `Error: Changing the socket encoding is not allowed per RFC7230 Section 3.`, thrown from
`node:_http_server` at `helpers.ts:224`. So every program that reached the model through a tunnel crashed the
handler, and no prompt was ever recorded. That was a fault of this suite's world, not of the work: the runner's
forwarder, the stand-in `claude` and any other client reach the model only through a tunnel.

**What changed.** Only that handler. It now keeps the tunnel's bytes as Buffers (the early bytes, then each `'data'`
chunk, concatenated), finds the first newline byte, and decodes that whole line as UTF-8 before parsing it. Its reply,
the answers, the gates, `signedIn` and `reached` are as they were. No expected value, criterion, judge, plant or other
file of the suite changed.

**How it was shown, with no DeepBuild involved.** A one-off vitest file outside the repo imported `Model` from
`helpers.ts`, started it, and then:

1. sent a raw `CONNECT api.anthropic.com:443` to it, then one JSON line `{"prompt": "Research this: <the trip topic> (café ✓)"}`,
   and read back `HTTP/1.1 200 Connection Established` and the reply line `{"answer":{"makes":"plan",…}}`;
2. did the same with the probe's sign-in gone, and read `{"error":"authentication_failed"}`;
3. ran `fixtures/claude.pl` with `-p --output-format stream-json -` and `HTTPS_PROXY` set to the model, and read the
   stream-json result with `"is_error":false`, exit 0.

The model kept 3 prompts, `reached(TRIP)` was 3, and they were answered `answer`, `authentication_failed`, `answer`.
The same file run against the helpers as committed before this fix timed out, with vitest reporting the unhandled
`Changing the socket encoding is not allowed per RFC7230 Section 3.` at `helpers.ts:224`.
