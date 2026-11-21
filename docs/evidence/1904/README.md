# #1904 hand e2e: every GitHub REST caller against a stand-in GitHub

Run on the Mac at `b2e414db4`, Node 24.22.0, after `npm run build --workspaces`:

```
node docs/evidence/1904/e2e.mjs "$PWD"    # each caller's built code against a stand-in GitHub on 127.0.0.1
node docs/evidence/1904/real.mjs "$PWD"   # one real read of api.github.com, no token
```

`e2e.mjs` drives each of the twelve call sites from its built `dist` code: `githubPushes`, `revoke`, `Forge.pullFor`,
`liveFetch`, `liveGraphql`, an archive pass with a forge, and the hub's `Work`, `Landing` (its REST call and its status
post, after a real `git push` to a local bare origin), `Intake` (repo and issue) and `Workspaces` (issue filing). Each
runs three times against a stand-in GitHub:

- **ok**: one same-origin redirect (301 for a GET, 307 otherwise), then GitHub's answer: followed, with the token.
- **cross-host**: a redirect to `http://localhost:<another port>`: refused before that host is asked, so it sees no
  request and no token.
- **loop**: a redirect to itself, forever: refused after six requests (five redirects).

Result: 24/24 cross-host and loop rows bounded, 12/12 ok rows followed, and the real call answered 200 with no token
sent (`liveFetch` sends one only when it is given one). The merge base's answer per caller is in
`tests/acceptance/1904/README.md` and `BASE-FAILURE.txt`.

`e2e-terminal.txt` is the Terminal window's contents after the run, read with AppleScript; `e2e-terminal.png` renders
that text with headless Chrome. A direct window capture wasn't possible here: the shell has no Screen Recording
permission, and the agent's Terminal grant was declined.
