// A host's link (#999; host-sessions.ts): one listener of the hub's own per host, only you can open, and one ssh that
// forwards the host's ~/.deepbuild/hub.sock to it (`ssh -R`). A hook on the host reaches the hub with nothing listening
// on the host's network, and a connection is the host's by the listener it came in on, never by what it says. The ssh
// is kept up: when it ends it is started again, a little later each time. What an ended link left at the host's path
// goes first: its own session there, found by the PID it wrote beside its listener's name, then the socket file, unless
// something else still listens on it, since another hub's link is never taken over.
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { addedHosts, hostKey, hostSocket } from './host-sessions.js';
import { sshEnded, sshOptions, sshScript } from './hosts.js';
import { shellQuote } from './shell.js';

/** Ends this hub's last link to the host (`$2` names it) if its session there outlived it, then clears the socket's path unless another listens on it. */
const CLEAR = String.raw`s="$1"; p="$HOME/.deepbuild/link.pid"; old=; hub=
[ -f "$p" ] && read -r old hub < "$p"; sshd=$(ps -o ppid= -p "$old" 2>/dev/null | tr -d ' ')
[ "$hub" = "$2" ] && [ "$(ps -o comm= -p "$old" 2>/dev/null)" = cat ] && case "$(ps -o comm= -p "$sshd" 2>/dev/null)" in sshd*) kill "$sshd" "$old" 2>/dev/null; sleep 0.2 ;; esac
if command -v ss >/dev/null 2>&1 && ss -Hlx 2>/dev/null | grep -qF "$s "; then echo busy; else rm -f "$s"; echo clear; fi`;
/**
 * What the forwarding ssh runs on the host: it writes its PID and the link's name (`$1`), says the forward is up, then
 * lives as long as the link does, saying `spool` every few seconds while deep-hook there has spooled a hook the hub
 * was late for.
 */
const HOLD = 'echo "$$ $1" > "$HOME/.deepbuild/link.pid"; echo up; (while kill -0 $$ 2>/dev/null; do [ -f "$HOME/.deepbuild/spool/spool.jsonl" ] && echo spool; sleep 5; done) & exec cat';

interface LinkOptions {
  /** The hub's root: the listeners live in <root>/hosts, and the hosts added are read from it. */
  root: string;
  /** A connection from a host's deep-hook. */
  accept(sock: net.Socket, host: string): void;
  /** The link came up or went down, or the host spooled while it was up: settles once the core has dealt with it, the host's spool taken. */
  said(host: string, state: 'up' | 'down' | 'spool', why: string): Promise<void>;
}
interface Link { remote: string; local: string; server: net.Server; child?: ChildProcess | undefined; timer?: NodeJS.Timeout; state: 'new' | 'up' | 'down'; why: string; gate: Promise<void>; /** How its first try ended, once it has. */ tried: Promise<string>; first?: ((state: string) => void) | undefined }

export class HostLinks {
  private readonly links = new Map<string, Link>();
  private closed = false;
  constructor(private readonly o: LinkOptions) {}

  /** Opens the link of each host added before this hub started. */
  start(): void {
    for (const [host, added] of Object.entries(addedHosts(this.o.root))) void this.open(host, hostSocket(added.home)).catch((error: unknown) => process.stderr.write(`deep hub: ${host}'s link: ${error instanceof Error ? error.message : String(error)}\n`));
  }
  /** Opens a host's link, or leaves the one it has: how its first try ended, `up` or why it isn't. */
  async open(host: string, remote: string): Promise<string> {
    const had = this.links.get(host);
    if (had) return had.state === 'new' ? had.tried : had.state === 'up' ? had.gate.then(() => 'up') : had.why;
    const dir = join(this.o.root, 'hosts');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const local = join(dir, `${hostKey(host)}.sock`);
    rmSync(local, { force: true });
    const server = net.createServer({ allowHalfOpen: false }, (sock) => this.o.accept(sock, host));
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(local, resolve));
    chmodSync(local, 0o600);
    const link: Link = { remote, local, server, state: 'new', why: '', gate: Promise.resolve(), tried: Promise.resolve('') };
    link.tried = new Promise<string>((first) => { link.first = first; });
    this.links.set(host, link);
    void this.connect(host, link, 500);
    return link.tried;
  }
  /** Settles once hooks from the host may be read: its spool, as of the link's return, is in the record. */
  gate(host: string): Promise<void> { return this.links.get(host)?.gate ?? Promise.resolve(); }

  private async connect(host: string, link: Link, wait: number): Promise<void> {
    // A hub that stopped, or a host removed since, has no link to bring up.
    const over = () => this.closed || this.links.get(host) !== link;
    if (over()) return;
    const failed = (why: string) => {
      if (over()) return;
      // Said once for each time it goes down, the first try included: a hub that starts with no link has none.
      if (link.state !== 'down') void this.o.said(host, 'down', why);
      Object.assign(link, { state: 'down', why });
      link.first?.(why);
      link.first = undefined;
      link.timer = setTimeout(() => void this.connect(host, link, Math.min(wait * 2, 10_000)), wait);
      link.timer.unref();
    };
    // This hub's link to the host, as the host's link.pid names it: by its listener here.
    const name = hostKey(link.local);
    const cleared = await sshEnded(sshScript(host, [link.remote, name], CLEAR));
    const said = cleared.stdout.trim().split('\n').at(-1);
    if (said !== 'clear') return failed(said === 'busy' ? `something else listens on ${link.remote} on ${host}: a hub there, or another hub's link` : `ssh to ${host} ended ${String(cleared.code)}: ${cleared.stderr.trim().slice(-300)}`);
    if (over()) return;
    // Run by sh there, whatever your login shell is.
    const child = spawn('ssh', [...sshOptions(), '-o', 'ExitOnForwardFailure=yes', '-R', `${link.remote}:${link.local}`, '--', host, `exec sh -c ${shellQuote(HOLD)} sh ${name}`], { stdio: ['pipe', 'pipe', 'pipe'] });
    link.child = child;
    child.stdin!.on('error', () => undefined);
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-2000)));
    child.stdout!.on('data', () => {
      if (link.state === 'up') return void this.o.said(host, 'spool', '');
      link.state = 'up';
      wait = 500;
      link.gate = this.o.said(host, 'up', '').then(() => { link.first?.('up'); link.first = undefined; });
    });
    // Its end, once: an ssh that couldn't start has no close.
    const ended = (how: string) => {
      if (link.child !== child) return;
      link.child = undefined;
      failed(`the link to ${host} ended (${how})${err.trim() ? `: ${err.trim().slice(-300)}` : ''}`);
    };
    child.on('error', (error) => ended(error.message));
    child.on('close', (code) => ended(`ssh exit ${String(code)}`));
  }

  /** Ends a host's link for good (`deep host remove`), by its own ssh's PID, and what it left at the host's path. */
  async forget(host: string): Promise<void> {
    const link = this.links.get(host);
    if (!link) return;
    this.links.delete(host);
    clearTimeout(link.timer);
    const child = link.child;
    link.child = undefined;
    child?.kill('SIGTERM');
    link.server.close();
    rmSync(link.local, { force: true });
    if (link.state !== 'down') await this.o.said(host, 'down', `${host} was removed, so its sessions no longer record here`);
    await sshEnded(sshScript(host, [link.remote], 'rm -f "$1" "$HOME/.deepbuild/link.pid"; rmdir "$HOME/.deepbuild/bin" "$HOME/.deepbuild/spool" "$HOME/.deepbuild/originals" 2>/dev/null; true'));
  }
  /** Ends every link, by its own ssh's PID; the hosts keep spooling. */
  close(): void {
    this.closed = true;
    for (const link of this.links.values()) {
      clearTimeout(link.timer);
      link.child?.kill('SIGTERM');
      link.server.close();
      rmSync(link.local, { force: true });
    }
  }
}
