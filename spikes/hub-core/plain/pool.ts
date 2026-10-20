// The lease pool: each port goes to one hold at a time, and holds waiting for one are served first
// come, first served.
export interface Lease {
  port: number;
  session: string;
  hold: string;
}

interface Waiter {
  session: string;
  hold: string;
  grant(port: number): void;
}

export class Pool {
  readonly ports: readonly number[];
  readonly #free: number[];
  readonly #held = new Map<number, Lease>();
  readonly #waiting: Waiter[] = [];

  constructor(ports: number[]) {
    this.ports = ports;
    this.#free = [...ports];
  }

  held(): Lease[] {
    return [...this.#held.values()];
  }

  // Resolves with a leased port, or with undefined if `signal` aborts first.
  acquire(session: string, hold: string, signal: AbortSignal): Promise<number | undefined> {
    if (signal.aborted) return Promise.resolve(undefined);
    const port = this.#free.shift();
    if (port !== undefined) {
      this.#held.set(port, { port, session, hold });
      return Promise.resolve(port);
    }
    return new Promise((resolve) => {
      const leave = () => {
        this.#waiting.splice(this.#waiting.indexOf(waiter), 1);
        resolve(undefined);
      };
      const waiter: Waiter = {
        session,
        hold,
        grant(granted) {
          signal.removeEventListener('abort', leave);
          resolve(granted);
        },
      };
      signal.addEventListener('abort', leave, { once: true });
      this.#waiting.push(waiter);
    });
  }

  release(port: number): void {
    this.#held.delete(port);
    const next = this.#waiting.shift();
    if (!next) {
      this.#free.push(port);
      return;
    }
    this.#held.set(port, { port, session: next.session, hold: next.hold });
    next.grant(port);
  }
}
