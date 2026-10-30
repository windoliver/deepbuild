// DeepBuild's pi package, in-process: pi's session and tool events go to the hub as hook requests, in order and off
// pi's path; the deep_* tools are native tools over the hub's socket; and an answer the hub hands over reaches the
// session through pi.sendUserMessage. It never decides anything, and nothing it reports is evidence but the events pi
// itself fired. Rules don't reach a pi session yet: deep-hook is the one matcher and it doesn't run here, so `matched`
// is empty and no guard blocks a pi call.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Obj = Record<string, unknown>;
interface Ctx { cwd: string; isIdle(): boolean; hasPendingMessages(): boolean; sessionManager: { getSessionId(): string; getSessionFile(): string | undefined } }
interface Pi {
  on(event: string, handler: (event: never, ctx: Ctx) => unknown): void;
  registerTool(tool: Obj): void;
  sendUserMessage(content: string, options?: { deliverAs?: 'steer' | 'followUp' }): void;
}

/** The wrong programs the #40 tests plant; only tests set the variable. */
const plant = process.env.DEEP_PI_PLANT;
/** How long after an input no run started means an extension took it. */
const HANDLED_MS = 200;
/** Longer than any call the hub holds open: deep_ask and deep_wait answer "still waiting" after 40 s. */
const ANSWER_MS = 55_000;
const UNREACHABLE_MS = 1000;
const line = (value: Obj): string => `${JSON.stringify({ v: 1, ...value })}\n`;

/** The hub's socket: `hub.address` in ~/.deepbuild/config.json, or the installed hub's; a worktree a dev hub serves reads that one. */
function hubSocket(cwd: string): string {
  const root = join(process.env.HOME ?? homedir(), '.deepbuild');
  const file = join(root, 'config.json');
  let hub: { address?: unknown; use?: unknown } | undefined;
  if (existsSync(file)) try { hub = (JSON.parse(readFileSync(file, 'utf8')) as { hub?: typeof hub }).hub; } catch { /* the doctor names it */ }
  const uses = typeof hub?.use === 'object' && hub.use !== null ? Object.entries(hub.use as Obj).filter(([dir]) => cwd === dir || cwd.startsWith(`${dir}/`)).sort((a, b) => b[0].length - a[0].length) : [];
  const address = uses[0]?.[1] ?? hub?.address;
  return typeof address === 'string' && address.startsWith('unix:') ? address.slice(5) : join(root, 'hub.sock');
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(): string {
  let time = Date.now();
  let head = '';
  for (let i = 0; i < 10; i++) { head = CROCKFORD[time % 32]! + head; time = Math.floor(time / 32); }
  return head + [...randomBytes(16)].map((b) => CROCKFORD[b % 32]).join('');
}
const startOf = (pid: number): Promise<string> => new Promise((done) => {
  execFile('ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' } }, (error, out) => done(error ? '' : out.trim()));
});

/**
 * One hook request on its own connection: the hub's hello, the request, its acknowledgement, its reply. `undefined`
 * when the hub can't be reached or doesn't answer in time. The hub posts a hook in the step it acknowledges it, so the
 * next one, sent only after this acknowledgement, lands after it.
 */
const HELD_MS = 70_000;
function sendHook(socket: string, event: string, payload: Obj, acked: () => void): Promise<{ exit: number; stdout: string; stderr: string } | undefined> {
  return new Promise((resolve) => {
    const sock = net.connect(socket);
    let buffer = '';
    let greeted = false;
    let ack = false;
    const end = (value?: { exit: number; stdout: string; stderr: string }) => { clearTimeout(timer); if (!ack) acked(); sock.destroy(); resolve(value); };
    let timer = setTimeout(() => end(), 15_000);
    sock.on('error', () => end());
    sock.on('close', () => end());
    sock.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const message = JSON.parse(buffer.slice(0, i)) as Obj;
        buffer = buffer.slice(i + 1);
        if (!greeted) {
          greeted = true;
          const seq = (BigInt(Date.now()) * 1_000_000n).toString();
          sock.write(line({ agent: 'pi', event, seq, id: ulid(), pid: process.pid, ppid: process.pid, matched: [], payload }));
        } else if ('ack' in message) {
          ack = true;
          acked();
          // Acknowledged, it may be held: the hub keeps a stop for its checks up to a minute.
          clearTimeout(timer);
          timer = setTimeout(() => end(), HELD_MS);
        } else if ('exit' in message) end(message as { exit: number; stdout: string; stderr: string });
      }
    });
  });
}

/** One connection to the hub as this session's deep tools, as `deep mcp` holds one; pi itself is the process it proves. */
class Tools {
  private sock: net.Socket | undefined;
  private connecting: Promise<boolean> | undefined;
  private readonly waiting = new Map<string, (message: Obj) => void>();
  private ids = 0;
  closed = false;
  constructor(private readonly socket: string, private readonly cwd: string) {}
  private connect(): Promise<boolean> {
    if (this.sock) return Promise.resolve(true);
    if (this.closed) return Promise.resolve(false);
    return this.connecting ??= new Promise<boolean>((resolve) => {
      const sock = net.connect(this.socket);
      let buffer = '';
      let greeted = false;
      const fail = () => {
        clearTimeout(timer);
        sock.destroy();
        if (this.sock === sock) this.sock = undefined;
        for (const wake of this.waiting.values()) wake({ error: { remediation: 'The DeepBuild hub closed the connection; nothing was recorded. Call again once it is back.' } });
        this.waiting.clear();
        resolve(false);
      };
      const timer = setTimeout(fail, UNREACHABLE_MS);
      sock.on('error', fail);
      sock.on('close', fail);
      sock.setEncoding('utf8').on('data', (chunk: string) => {
        buffer += chunk;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const message = JSON.parse(buffer.slice(0, i)) as Obj;
          buffer = buffer.slice(i + 1);
          if (!greeted) {
            greeted = true;
            void startOf(process.pid).then((start) => sock.write(line({ hello: 'mcp', parent: { pid: process.pid, start }, cwd: this.cwd })));
          } else if ('role' in message) {
            clearTimeout(timer);
            this.sock = sock;
            resolve(true);
          } else {
            const wake = this.waiting.get(String(message.id));
            this.waiting.delete(String(message.id));
            wake?.(message);
          }
        }
      });
    }).finally(() => { this.connecting = undefined; });
  }
  /** A method on this connection: its reply, or the refusal as `error`. */
  async call(method: string, params: Obj, ms = ANSWER_MS): Promise<Obj> {
    if (!(await this.connect()) || !this.sock) return { error: { remediation: 'The DeepBuild hub is unreachable; nothing was recorded. Call again once it is back.' } };
    const id = `pi#${++this.ids}`;
    return new Promise((resolve) => {
      const timer = ms > 0 ? setTimeout(() => { this.waiting.delete(id); resolve({ error: { remediation: 'The DeepBuild hub did not answer in time.' } }); }, ms) : undefined;
      this.waiting.set(id, (message) => { clearTimeout(timer); resolve(message); });
      this.sock!.write(line({ id, method, params }));
    });
  }
  /** Says hello again on the next call: the hub binds a connection to its session once, at hello. */
  rebind(): void {
    this.sock?.destroy();
    this.sock = undefined;
  }
  close(): void {
    this.closed = true;
    this.sock?.destroy();
  }
}

const here = (): string => new URL('.', import.meta.url).pathname;

export default function deepbuild(pi: Pi): void {
  const tools = JSON.parse(readFileSync(join(here(), 'tools.json'), 'utf8')) as { name: string; description: string; inputSchema: Obj }[];
  const own = new Set(tools.map((tool) => tool.name));
  // One runtime's session: pi replaces the whole extension runtime on /new, /resume, /fork and reload.
  let ctx: Ctx | undefined;
  let session = '';
  let socket = '';
  let client: Tools | undefined;
  let version = '';
  let sending: Promise<unknown> = Promise.resolve();
  let running = 0;
  let pendingInput: { payload: Obj; timer: NodeJS.Timeout } | undefined;
  /** Answers the hub handed over that wait for a place in the session. */
  const held: { asks: string[]; text: string }[] = [];
  const delivered = new Set<string>();

  /** In the order pi fired them: each goes once the one before is acknowledged, so the handler that sent it doesn't wait. */
  function hook(event: string, fields: Obj): Promise<{ exit: number; stdout: string; stderr: string } | undefined> {
    const file = ctx?.sessionManager.getSessionFile();
    const payload = { hook_event_name: event, session_id: session, cwd: ctx?.cwd ?? process.cwd(), ...(file ? { transcript_path: file } : {}), ...(version ? { agent_version: version } : {}), ...fields };
    let acked!: () => void;
    const ack = new Promise<void>((done) => { acked = done; });
    const reply = sending.then(() => sendHook(socket, event, payload, acked));
    sending = ack;
    return reply;
  }
  const flushInput = (fields: Obj = {}): void => {
    if (!pendingInput) return;
    clearTimeout(pendingInput.timer);
    const { payload } = pendingInput;
    pendingInput = undefined;
    void hook('input', { ...payload, ...fields });
  };

  /** What became of answers, until the hub has it: a lost report would leave them open for good. */
  async function report(asks: string[], via: string, outcome: string): Promise<void> {
    const mine = client;
    for (let tries = 0; tries < 5 && mine && !mine.closed; tries++) {
      if (!(await mine.call('session.delivered', { session, asks, via, outcome })).error) return;
      await new Promise((done) => setTimeout(done, 1000).unref());
    }
  }
  /** Sent and not yet seen: pi's own message_start says one reached the session. */
  const sent: { asks: string[]; text: string; via: string; how: 'steer' | 'followUp' | undefined }[] = [];
  const reached = (entry: (typeof sent)[number]): void => {
    const at = sent.indexOf(entry);
    if (at < 0) return;
    sent.splice(at, 1);
    void report(entry.asks, entry.via, 'delivered');
  };
  /**
   * An answer sent now: a new turn when the session is idle, steered in after the running tool calls when it is busy,
   * or queued at the pre-settle boundary, the one place a run may continue.
   */
  function send(answer: { asks: string[]; text: string }, how?: 'steer' | 'followUp'): void {
    // Handed again by a hub that lost the report, which it reads once.
    if (answer.asks.every((ask) => delivered.has(ask))) {
      if (!sent.some((entry) => entry.asks.some((ask) => answer.asks.includes(ask)))) void report(answer.asks, how === 'steer' ? 'steer' : 'next_prompt', 'delivered');
      return;
    }
    for (const ask of answer.asks) delivered.add(ask);
    if (how) pi.sendUserMessage(answer.text, { deliverAs: how });
    else pi.sendUserMessage(answer.text);
    const via = how === 'steer' ? 'steer' : 'next_prompt';
    if (plant === 'waits-for-agent-start') {
      afterStart.push(() => void report(answer.asks, via, 'delivered'));
      return;
    }
    const entry = { ...answer, via, how };
    sent.push(entry);
    // A prompt an extension took starts no run and fires no message: an idle session a moment on is its one outcome.
    if (!how) setTimeout(() => { if (ctx?.isIdle() === true && running === 0) reached(entry); }, HANDLED_MS);
  }
  const afterStart: (() => void)[] = [];
  /**
   * What the session can take now. A tool call running takes a steer, which reaches the model after the calls' results.
   * While only a model request runs nothing goes in: it may end in an error pi retries on its own, so the answer waits
   * for a tool call or the run's settling, and starts no competing continuation.
   */
  function place(toolsRunning: boolean): void {
    if (!held.length) return;
    // pi reads idle until a prompt's input handlers return, and refuses a second prompt then: one at a time.
    const idle = ctx?.isIdle() === true && running === 0 && !pendingInput && !sent.some((entry) => !entry.how);
    if (idle) {
      const all = held.splice(0);
      send({ asks: all.flatMap((answer) => answer.asks), text: all.map((answer) => answer.text).join('\n\n') });
    } else if (toolsRunning) for (const answer of held.splice(0)) send(answer, 'steer');
    // No event says a compaction or a prompt's start has passed; a run says so itself when it settles.
    else if (running === 0) setTimeout(() => place(toolCalls > 0), 100).unref();
  }
  /** The hub's long wait for this session's answers: one at a time, asked again after each, until the session goes. */
  async function listen(mine: Tools): Promise<void> {
    while (!mine.closed) {
      const reply = await mine.call('session.wait', { session, cwd: ctx?.cwd ?? '', push: true }, 0);
      if (mine.closed) return;
      const result = reply.result as { text?: string; asks?: string[]; exit?: string } | undefined;
      if (result?.text && result.asks) {
        held.push({ asks: result.asks, text: result.text });
        place(toolCalls > 0);
      } else if (result?.exit === 'session ended') return;
      else if ((reply.error as { code?: string } | undefined)?.code === 'role' && ctx?.sessionManager.getSessionFile()) {
        // A restarted hub knows this session from its next hook, and an idle session sends none: say it's here.
        await hook('session_start', { source: 'resume' });
        mine.rebind();
        await new Promise((done) => setTimeout(done, 1000).unref());
      } else await new Promise((done) => setTimeout(done, reply.error ? 1000 : 50).unref());
    }
  }
  let toolCalls = 0;

  for (const tool of tools) {
    pi.registerTool({
      name: tool.name, label: tool.name, description: tool.description, parameters: tool.inputSchema,
      async execute(_id: string, params: Obj, signal?: AbortSignal) {
        if (!client) throw Error('DeepBuild has no session here yet; call again once the session has started.');
        // An aborted call stops waiting at once: its answer comes as a message of its own, never to a call nobody reads.
        let aborted!: () => void;
        const gone = new Promise<Obj>((_, reject) => { aborted = () => reject(Error('Aborted: your answer comes as a message of its own.')); });
        const stop = () => { aborted(); void client?.call('session.stop_waiting', { session }, 5000); };
        signal?.addEventListener('abort', stop, { once: true });
        try {
          const reply = await Promise.race([client.call('mcp.call', { tool: tool.name, arguments: params }), gone]);
          if ('error' in reply) throw Error(JSON.stringify(reply.error));
          // The call that returns an answer is what delivers it: only now has the session got it.
          const got = reply.result as { ask?: string; status?: string } | undefined;
          if (got?.status === 'answered' && got.ask && !delivered.has(got.ask.slice(4))) {
            delivered.add(got.ask.slice(4));
            void report([got.ask.slice(4)], 'steer', 'delivered');
          }
          return { content: [{ type: 'text', text: JSON.stringify(reply.result) }], details: reply.result };
        } finally {
          signal?.removeEventListener('abort', stop);
        }
      },
    });
  }

  const on = (event: string, handler: (event: Obj, ctx: Ctx) => unknown): void => pi.on(event, handler as never);
  on('session_start', async (event, c) => {
    ctx = c;
    // pi fires it again for a session a new runtime took over: one start, one connection.
    if (session === c.sessionManager.getSessionId()) return;
    session = c.sessionManager.getSessionId();
    socket = hubSocket(c.cwd);
    // The session it replaced names itself in its file's name; the module's state went with the old runtime.
    const previous = typeof event.previousSessionFile === 'string' ? /_([0-9a-f-]{20,})\.jsonl$/.exec(event.previousSessionFile)?.[1] : undefined;
    try { version = (await import('@earendil-works/pi-coding-agent' as string) as { VERSION?: string }).VERSION ?? ''; } catch { /* a host without it reads as unverified */ }
    // The hub needs the session's start before its tools' connection binds to it.
    await hook('session_start', { source: String(event.reason), ...(previous && previous !== session ? { parent: previous } : {}) });
    client = new Tools(socket, c.cwd);
    void listen(client);
  });
  on('session_shutdown', async (event) => {
    flushInput();
    const reason = String(event.reason);
    // What this runtime still held never reaches the session that follows.
    held.push(...sent.splice(0));
    if (reason !== 'reload' && reason !== 'quit' && held.length) void report(held.splice(0).flatMap((answer) => answer.asks), 'next_prompt', 'replaced');
    const mine = client;
    client = undefined;
    // A reload is the same session in a new runtime; only a session that goes ends.
    if (reason !== 'reload') await hook('session_shutdown', { reason });
    else await sending;
    mine?.close();
  });
  on('input', (event) => {
    flushInput();
    // Whether a run follows shows only afterwards: an extension after this one may take the input without one.
    const payload = { prompt: String(event.text), source: String(event.source) };
    pendingInput = { payload, timer: setTimeout(() => flushInput(ctx?.isIdle() === true ? { disposition: 'handled' } : {}), HANDLED_MS) };
    return undefined;
  });
  on('before_agent_start', () => { flushInput(); return undefined; });
  on('message_start', (event) => {
    const message = event.message as { role?: string; content?: unknown } | undefined;
    if (message?.role !== 'user') return undefined;
    const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');
    for (const entry of [...sent]) if (text.includes(JSON.stringify(entry.text).slice(1, -1))) reached(entry);
    return undefined;
  });
  on('agent_start', () => {
    flushInput();
    running++;
    stopSent = false;
    for (const report of afterStart.splice(0)) report();
    void hook('agent_start', {});
  });
  on('agent_end', () => {
    running = Math.max(0, running - 1);
    void hook('agent_end', {});
    // The planted wrong program sends what it holds at a run's end, though pi may yet retry it.
    if (plant === 'continues-on-end') for (const answer of held.splice(0)) send(answer);
  });
  on('tool_call', async (event) => {
    const name = String(event.toolName);
    const reply = await hook('tool_call', {
      // Our own native tools read as `deep mcp`'s do, so nothing downstream counts them as change.
      tool_name: own.has(name) ? `mcp__deep__${name}` : name, tool_input: (event.input ?? {}) as Obj, tool_use_id: String(event.toolCallId),
      ...(event.parentToolCallId ? { parent_tool_use_id: String(event.parentToolCallId) } : {}),
    });
    if (reply && reply.exit !== 0) return { block: true, reason: reply.stderr.trim() || 'DeepBuild blocked this call.' };
    return undefined;
  });
  on('tool_execution_start', (event) => { if (!event.parentToolCallId) { toolCalls++; place(true); } });
  on('tool_execution_end', (event) => { if (!event.parentToolCallId) toolCalls = Math.max(0, toolCalls - 1); });
  on('tool_result', (event) => {
    const name = String(event.toolName);
    // pi writes its record of nested calls after this event: what the call's context holds so far is what a handler can
    // see, and message_end brings the record pi kept. The call's after waits for it.
    if (event.parentToolCallId) {
      void hook('tool_result', after(event, name, undefined));
      return undefined;
    }
    results.set(String(event.toolCallId), () => after(event, name, undefined));
    return undefined;
  });
  const results = new Map<string, () => Obj>();
  function after(event: Obj, name: string, nested: Obj | undefined): Obj {
    const failed = event.isError === true;
    const text = failed && Array.isArray(event.content) ? (event.content as { text?: string }[]).map((part) => part.text ?? '').join('') : '';
    return {
      tool_name: own.has(name) ? `mcp__deep__${name}` : name, tool_use_id: String(event.toolCallId), tool_input: (event.input ?? {}) as Obj, outcome: failed ? 'failed' : 'ok',
      ...(event.parentToolCallId ? { parent_tool_use_id: String(event.parentToolCallId) } : {}), ...(text ? { error: text.slice(0, 4096) } : {}), ...(nested ? { nested_calls: nested } : {}),
    };
  }
  on('message_end', (event) => {
    const message = event.message as { role?: string; toolCallId?: string; nestedCalls?: { complete?: boolean; calls?: unknown[] } } | undefined;
    if (message?.role !== 'toolResult' || !message.toolCallId) return undefined;
    const built = results.get(message.toolCallId);
    if (!built) return undefined;
    results.delete(message.toolCallId);
    const record = message.nestedCalls;
    // The planted wrong program normalizes an incomplete record away.
    const nested = record ? { complete: plant === 'drops-incomplete' ? true : record.complete !== false, ...(Array.isArray(record.calls) ? { calls: record.calls.length } : {}) } : undefined;
    void hook('tool_result', { ...built(), ...(nested ? { nested_calls: nested } : {}) });
    return undefined;
  });
  let stopSent = true;
  on('agent_before_settle', async (event) => {
    stopSent = true;
    const outcome = event.outcome === 'completed' ? 'finished' : 'failed';
    const reply = await hook('agent_before_settle', { outcome });
    // The hub's send-back: the only hook that may continue a run, and only the hub's words do.
    const out = reply?.stdout ? JSON.parse(reply.stdout) as { decision?: string; reason?: string } : {};
    if (held.length && event.outcome === 'completed') {
      for (const answer of held.splice(0)) send(answer, 'followUp');
      // pi reads its queue when this handler returns, and sendUserMessage queues a step later.
      for (let tries = 0; tries < 100 && !ctx?.hasPendingMessages(); tries++) await new Promise((done) => setTimeout(done, 2));
    }
    if (out.decision === 'block' && out.reason) return { continue: true, entries: [{ type: 'custom_message', customType: 'deepbuild', content: out.reason, display: true }] };
    return undefined;
  });
  on('agent_settled', (event) => {
    // An aborted run skips pi's pre-settle hook, and its stop is still the one a run ends with.
    if (!stopSent && event.aborted === true) void hook('agent_before_settle', { outcome: 'failed' });
    stopSent = true;
    void hook('agent_settled', {});
    running = 0;
    // What pi cleared unread, as an abort clears its queue, goes again as a turn of its own.
    for (const entry of sent.splice(0)) {
      for (const ask of entry.asks) delivered.delete(ask);
      held.push({ asks: entry.asks, text: entry.text });
    }
    // pi goes idle only after its handlers for this event return, and no later event says so.
    const settle = (tries: number): void => {
      place(false);
      if (held.length && running === 0 && tries > 0) setTimeout(() => settle(tries - 1), 20).unref();
    };
    settle(100);
  });
}
