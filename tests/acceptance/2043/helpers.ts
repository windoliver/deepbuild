// Test-side tools for #2043 (README). Every hub here is `deep hub run` on a temp home, a real process, reached only
// through its socket; #16's helpers make the homes, start the hubs and stop, by PID, only what this suite started.
import { expect } from 'vitest';
import { Conn, control, health, sleep, type Hub, type Line } from '../16/helpers.ts';

/** The criteria, by `#2043.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = { ac1: '#2043.cbf38aec', ac2: '#2043.ccd54552', ac3: '#2043.d1e23f18', ac4: '#2043.43f43d35' } as const;

/** The five names every plain object has (the issue's own list). */
export const NAMES = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'] as const;

export interface Exchange {
  /** Every line after the hello, parsed. */
  lines: Line[];
  /** `answered`: a line with `exit` or `error` came; `closed`: the hub closed the connection first; `timeout`: still waiting. */
  end: string;
  /** Whether the hub had closed the connection by 2 s after its last line. */
  closed: boolean;
}
/** One line written as a new connection's first, as deep-hook writes it: what the hub sends back, and whether it ends the connection. */
export async function exchange(socket: string, text: string, timeoutMs = 10_000): Promise<Exchange> {
  let conn: Conn;
  try {
    conn = await Conn.open(socket, 5000);
  } catch (error) {
    return { lines: [], end: `unreachable (${(error as Error).message})`, closed: true };
  }
  conn.write(text.endsWith('\n') ? text : `${text}\n`);
  const last = await conn.until((line) => 'exit' in line || 'error' in line, timeoutMs);
  const closed = last ? await conn.closed(2000) : conn.ended;
  const lines = conn.received.slice(1).map((r) => r.json ?? { unparsed: r.raw });
  const end = last ? 'answered' : conn.ended || conn.failure ? 'closed' : 'timeout';
  conn.close();
  return { lines, end, closed };
}
/** An exchange as a failure message shows it. */
export const shown = (x: Exchange): string =>
  `${JSON.stringify(x.lines)}, ${x.end === 'answered' ? `answered${x.closed ? ', then closed' : ''}` : x.end === 'closed' ? 'then the connection closed with no answer' : x.end === 'timeout' ? 'still waiting at the timeout' : x.end}`;

/** An acknowledgement of this line's ID and a reply with an exit status: the hook was answered. */
export const isAnswer = (x: Exchange, id: string): boolean =>
  x.lines.some((l) => l.ack === id) && x.lines.some((l) => typeof l.exit === 'number') && !x.lines.some((l) => 'error' in l);
/** A refusal (error@1's shape: a code and a remediation) and nothing that acknowledges or answers the line. */
export const isRefusal = (x: Exchange): boolean =>
  x.lines.some((l) => typeof l.error === 'object' && l.error !== null && typeof l.error.code === 'string' && l.error.code !== '' && typeof l.error.remediation === 'string')
  && !x.lines.some((l) => 'ack' in l || 'exit' in l);

/** The same exchange as `x`, its line's ID and any other text swapped as named: what another line answered alike reads. */
export function alike(x: Exchange, swaps: Array<[string, string]>): Exchange {
  let text = JSON.stringify(x.lines);
  for (const [from, to] of swaps) text = text.split(from).join(to);
  return { ...x, lines: JSON.parse(text) as Line[] };
}

/** What became of the hub, for a failure message: still running, or ended, with the end of its stderr. */
export async function fate(hub: Hub, waitMs = 2000): Promise<string> {
  const exit = await Promise.race([hub.proc.exit, sleep(waitMs).then(() => undefined)]);
  return exit
    ? `the hub's process ${hub.pid} ended (code ${exit.code}, signal ${exit.signal}); its stderr ends: ${hub.proc.stderr().trim().slice(-900)}`
    : `the hub's process ${hub.pid} still runs`;
}
/** The process ID a new control connection's hub.health reports, or why none could be read. */
export async function pidNow(hub: Hub): Promise<number | string> {
  let cli: Conn | undefined;
  try {
    cli = await control(hub);
    return (await health(cli)).pid as number;
  } catch (error) {
    return `no hub.health (${(error as Error).message})`;
  } finally {
    cli?.close();
  }
}
/** Asserts `ok`; its message, which may wait on the hub's fate, is made only when it fails. */
export async function must(ok: boolean, why: () => string | Promise<string>): Promise<void> {
  expect(ok, ok ? '' : await why()).toBe(true);
}
