// A background job's beat that stops once it has nothing to do (#2648), as the supervisor's scan does since Nov 10:
// an idle hub's timers wake it for nothing, so a job whose answer can't have changed waits for the event that gives
// it work, and that event starts its beat again.

/** How long a beat's runs find nothing to do before it stops. */
export const QUIET_MS = 5000;

/**
 * Runs `job` every `ms` while it reports work. Once its runs have found nothing to do for `quietMs`, the beat stops,
 * and `wake` starts it again: at once when its last run began a beat ago or more, else a beat after that run began.
 * Runs never overlap: a wake during a run is kept for the run after it, and a run that outlasts the beat on a loaded
 * machine delays the next instead of queueing it.
 */
export class Beat {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private woken = false;
  private last = -Infinity;
  private quietSince: number | undefined;
  private ended = false;

  /** `job` resolves true while it has work, so the beat keeps going; a failed run counts as work, to be tried again. */
  constructor(private readonly ms: number, private readonly job: () => Promise<boolean>, private readonly quietMs = QUIET_MS) {}

  /** The event that gives the job work. */
  wake(): void {
    if (this.ended) return;
    this.woken = true;
    if (!this.timer && !this.running) this.next();
  }
  /** The hub stops: no run starts after this, and no timer is left. */
  stop(): void {
    this.ended = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  private next(): void {
    this.timer = setTimeout(() => void this.beat(), Math.max(0, this.last + this.ms - Date.now()));
    this.timer.unref();
  }
  private async beat(): Promise<void> {
    this.timer = undefined;
    this.running = true;
    this.woken = false;
    this.last = Date.now();
    const busy = await this.job().catch(() => true);
    this.running = false;
    if (this.ended) return;
    if (busy || this.woken) this.quietSince = undefined;
    else if (Date.now() - (this.quietSince ??= this.last) >= this.quietMs) return;
    this.next();
  }
}

/**
 * The hub's beats by job name: each is listed when it starts, and each run goes through `run`, which keeps the job's
 * failures for hub.health as the hub's other background jobs keep theirs.
 */
export class Beats {
  private readonly all = new Map<string, Beat>();
  constructor(private readonly run: (name: string, job: () => Promise<void>) => Promise<void>, private readonly listed: (name: string) => void) {}

  /** A job run every `ms` while it says it has work, from now. */
  start(name: string, ms: number, job: () => Promise<boolean>): void {
    this.listed(name);
    const beat = new Beat(ms, async () => {
      let busy = true;
      await this.run(name, async () => { busy = await job(); });
      return busy;
    });
    this.all.set(name, beat);
    beat.wake();
  }
  /** The event that gives a job work. */
  wake(name: string): void {
    this.all.get(name)?.wake();
  }
  stop(): void {
    for (const beat of this.all.values()) beat.stop();
  }
}
