// The stand-in agent: one short turn per prompt ("done"), and, once its session is open, each stdio MCP server it was
// given started as the agent's child and asked for its tools (initialize, notifications/initialized, tools/list), the
// way an agent with MCP support loads them. Everything it saw goes to <cwd>/.dh55-provider.jsonl, one JSON per line:
// {open, cwd, servers}, {tools: {server, names, error}}, {prompt: {text, delivery}}, {turn: {id, state}}.
import type { ProviderConnection, ProviderEvent, ProviderInput, ProviderRegistration } from "@getpaseo/plugin/server/provider";
import { negotiateProviderCapabilities } from "@getpaseo/plugin/server/provider";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const CAPABILITIES = ["prompt.message", "prompt.steer", "session.persistence"] as const;
type Server = { type?: string; command?: string; args?: string[]; env?: Record<string, string> };

export function fakeProvider(): ProviderRegistration {
  return {
    id: "dh55-fake",
    label: "dh55 stand-in",
    icon: "icon.svg",
    async connect(request) {
      return connection(negotiateProviderCapabilities(request.capabilities, CAPABILITIES));
    },
  };
}

const log = (cwd: string, value: unknown): void => {
  try { appendFileSync(join(cwd, ".dh55-provider.jsonl"), `${JSON.stringify(value)}\n`); } catch { /* the folder went */ }
};

/** One stdio MCP server, started and asked for its tools; it is stopped once it has answered, or after 30 s. */
function listTools(cwd: string, name: string, server: Server): void {
  if (server.type !== "stdio" || !server.command) {
    log(cwd, { tools: { server: name, names: [], error: `not a stdio server: ${JSON.stringify(server)}` } });
    return;
  }
  const child = spawn(server.command, server.args ?? [], { cwd, env: { ...process.env, ...(server.env ?? {}) }, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  let err = "";
  let done = false;
  const finish = (names: string[], error: string | null) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    log(cwd, { tools: { server: name, names, error } });
    try { child.stdin.end(); } catch { /* gone */ }
    setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 1000).unref();
  };
  const timer = setTimeout(() => finish([], `no tools/list answer in 30 s; stderr ${err.slice(-500)}`), 30_000);
  const write = (line: unknown) => child.stdin.write(`${JSON.stringify(line)}\n`);
  child.on("error", (e) => finish([], String(e)));
  child.on("exit", (code) => finish([], `exited ${code} before answering; stderr ${err.slice(-500)}`));
  child.stderr.setEncoding("utf8").on("data", (d: string) => { err += d; });
  child.stdout.setEncoding("utf8").on("data", (d: string) => {
    buffer += d;
    for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
      const text = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      let reply: { id?: unknown; result?: { tools?: { name: string }[] }; error?: unknown };
      try { reply = JSON.parse(text); } catch { continue; }
      if (reply.id === 1) {
        write({ jsonrpc: "2.0", method: "notifications/initialized" });
        write({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      } else if (reply.id === 2) finish((reply.result?.tools ?? []).map((t) => t.name), reply.error ? JSON.stringify(reply.error) : null);
    }
  });
  write({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dh55-fake", version: "0" } } });
}

function connection(capabilities: readonly string[]): ProviderConnection {
  const listeners = new Set<(event: ProviderEvent) => void>();
  const sessions = new Map<string, { cwd: string; turn: number }>();
  const emit = (event: Record<string, unknown>) => { for (const listener of listeners) listener(event as unknown as ProviderEvent); };
  return {
    version: 1,
    capabilities,
    async send(input: ProviderInput) {
      queueMicrotask(() => {
        if (input.type === "catalog") {
          emit({ type: "catalog", requestId: input.requestId, catalog: { models: [{ id: "stand-in", label: "Stand-in" }], modes: [], defaultModel: "stand-in" } });
        } else if (input.type === "session.open") {
          const cwd = input.config.cwd;
          const persistence = input.persistence ?? { version: 1, data: { native: input.sessionId } };
          sessions.set(input.sessionId, { cwd, turn: 0 });
          const servers = (input.config.mcpServers ?? {}) as Record<string, Server>;
          log(cwd, { open: input.sessionId, cwd, servers });
          emit({ type: "session.opened", requestId: input.requestId, sessionId: input.sessionId, capabilities, restoration: "core", persistence, cwd });
          emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
          for (const [name, server] of Object.entries(servers)) listTools(cwd, name, server);
        } else if (input.type === "session.prompt") {
          const session = sessions.get(input.sessionId);
          if (!session) return;
          const prompt = input.prompt as { clientMessageId: string; delivery?: string; input: { type: string; content?: { type: string; text?: string }[] } };
          const text = (prompt.input.content ?? []).filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
          log(session.cwd, { prompt: { text, delivery: prompt.delivery ?? null } });
          session.turn += 1;
          const turnId = `t${session.turn}`;
          emit({ type: "timeline.item", sessionId: input.sessionId, item: { type: "user_message", id: `u${session.turn}`, text, clientMessageId: prompt.clientMessageId } });
          emit({ type: "session.prompt_result", sessionId: input.sessionId, clientMessageId: prompt.clientMessageId, result: { type: "turn", turnId } });
          emit({ type: "session.turn", sessionId: input.sessionId, turnId, state: "started" });
          emit({ type: "timeline.item", sessionId: input.sessionId, item: { type: "assistant_message", id: `a${session.turn}`, text: "done" } });
          emit({ type: "session.turn", sessionId: input.sessionId, turnId, state: "completed" });
          log(session.cwd, { turn: { id: turnId, state: "completed" } });
        } else if (input.type === "session.close") {
          sessions.delete(input.sessionId);
          emit({ type: "session.closed", sessionId: input.sessionId });
          emit({ type: "request.completed", requestId: input.requestId });
        } else if ("requestId" in input) emit({ type: "request.completed", requestId: (input as { requestId: string }).requestId });
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      listeners.clear();
      sessions.clear();
    },
  };
}
