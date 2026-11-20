# Evidence for #2896: a reply reaches the agent whole

Recorded 2026-11-19 on the Mac (load averages noted in each run file; other sessions were busy). Paths are redacted (`~`, `<scratch>`).

- `pages-run.txt`, `walk-run.txt`: the blind acceptance suite's `pages.test.ts` and `walk.test.ts` on the change. Every paging reply's page fits both stand-ins; the Codex walk takes 115 pages and the Claude Code walk 46, each with 10,000 rows, and the Codex walk's rows hash to the base's (`9913f78e…`). The other files (`facts`, `refusals`, `unknown`) passed in an earlier run (6 of 6).
- `e2e-pages.json`, from `e2e.test.ts.txt`: a manual drive through `deep mcp` over stdio on a fixture hub. Three clients (Claude Code 2.1.308, Codex 0.166.0-alpha.5.1, and an unknown client) each page a 3,000-row document's rows by cursor and `deep_kinds`' sheet by offset. Every page is kept whole by its stand-in.

| Client | Rows pages | Largest rows page | Sheet pages | Largest sheet page |
|---|---|---|---|---|
| claude-code 2.1.308 | 14 | 35,137 characters, 13,416 tokens | 2 | 33,415 characters, 11,983 tokens |
| codex-mcp-client 0.166.0-alpha.5.1 | 35 | 14,147 characters, 5,408 tokens | 3 | 14,376 characters, 5,503 tokens |
| acceptance-2896-client 1.0.0 (unknown) | 70 | 7,151 characters, 2,763 tokens | 6 | 7,342 characters, 2,829 tokens |

  The unknown client is held to the smallest figure in each unit any facts file holds: 50,000 characters, 10,000 tokens, and 10,000 bytes (Codex 0.144.0's gpt-5.2), each a fifth under.
- `live-claude-attempt.json`, from `live.test.ts.txt`: a real Claude Code (bundled 2.1.326, haiku, `claude -p`, $0.0035) with `deep mcp` as its MCP server and deep-hook as its hooks, on the same fixture hub. The call reached `deep mcp`, and every hook exited 0, but the canvas core refused it with `no_session`: the fixture hub doesn't bind a real Claude Code session's MCP call to a session it knows. A real session receiving a full page whole is therefore **not shown**; the stand-ins above keep a result exactly as the facts say Claude Code does.
