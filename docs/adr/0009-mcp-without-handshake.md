# 0009: MCP without a handshake

Status: accepted (#2855). The design says deep's MCP servers and the hub's lister speak the MCP revision that takes no handshake. The decisions below are written nowhere else.

## deep's servers

- **A server answers the way it was opened.** `packages/hub/src/mcp.ts`, `runMcp`; `crates/deep-hook/src/actions.rs`; `packages/reading/src/tools.mts`. Once `initialize` has run, a request's `_meta` is not read, so a client of the handshake revisions sees what it saw before. A request whose `_meta` names a revision without a handshake gets `resultType: "complete"`, no `ping`, and `-32602` for an unknown resource.
- **A request naming a revision no server holds gets `-32022` before its method runs.** Same places. Its data lists `supported` and `requested`, so nothing runs for a revision the server doesn't speak.
- **The client is named from each request's `clientInfo`, and kept when a request has none.** `packages/hub/src/mcp.ts`, `Hub.named`. Without a handshake no request names the client once, so the name the hub records comes from the request that carries it.
- **Discovery and lists are never cached.** `CACHED` in `packages/hub/src/mcp.ts`; `cached` in `actions.rs`. `server/discover`, `tools/list`, `resources/list` and `resources/read` carry `ttlMs: 0` and `cacheScope: "private"` (the issue's Values), since what a server offers follows the session.
- **The revisions without a handshake are a contract.** `packages/contracts/schemas/mcp.meta@1.json`. The hub reads its enum from the schema file and the hook from the generated `McpMetaProtocolVersion`, as `mcp.handshake@1` gives the handshake revisions. `supportedVersions` lists both, newest first.
- **The reading tools spell their revision in parts.** `packages/reading/src/tools.mts`, `ALONE`. #2854's check holds that the reading tools' quoted revisions are exactly `mcp.handshake@1`'s; `packages/reading/test/tools-revisions.test.ts` holds the parts to `mcp.meta@1`.

## The hub's lister

- **It asks `server/discover` first and falls back to `initialize`.** `packages/hub/src/mcp-servers.ts`, `listOf`. A `-32022` answer picks the newest revision both hold from its `supported`; any other error, or no answer within `PROBE_MS` (2 s), sends `initialize` at the handshake revision. Only a response settles the probe: a notification or request from the server does not.
- **The probe's wait is short of the whole limit.** `PROBE_MS`. A server that ignores the probe still gets `initialize` and its list inside the 10 s limit.
- **Reading stops once the list has ended.** `listOf`. A response that follows the last page in the same chunk of output is not read, so a list handed back is never added to; `packages/hub/test/mcp-servers-end.test.ts` holds it.
- **Which way a server listed is recorded.** `packages/contracts/schemas/mcp.tools_listed@3.json`, `handshake`; `packages/hub/src/holds.ts`.
