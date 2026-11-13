// deep-hook's spool, replayed (#21, #315): each line once, in the order it was written, through the core's hook path.
// Taken out of the core as one seam with its own options (#1687), as holds.ts and stacks.ts are.
import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseLine } from './hookmap.js';
import type { Plant } from './plant.js';
import { syncPath, type Durable } from './vfs.js';
import { ulid, ulidTime, type Draft, type HookMeta } from './wire.js';

/** The spool file every deep-hook appends to. */
const SPOOL = 'spool.jsonl';
/** How each request deep-hook writes begins, so one appended right after a cut line is found in it. */
const REQUEST = Buffer.from('{"v":1,"agent":');

interface SpoolOptions {
  /** The state folder's spool directory. */
  dir: string;
  held: string[];
  plant: Plant | undefined;
  durable: Durable;
  /** True once the hub is stopping: the rest of a file is kept for its next start. */
  stopping(): boolean;
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  appendCore(kind: string, data: Record<string, unknown>): Promise<void>;
  /** A Claude Code network stop's one try of its host, shared across the pass by `tries`. */
  tryNetwork(drafts: Draft[], meta: HookMeta, tries: Map<string, Promise<boolean>>): Promise<void> | undefined;
  /** The core's hook path, queued as a replayed hook; resolves once the hook has settled. */
  replay(drafts: Draft[], meta: HookMeta): Promise<void>;
  /** A FULL commit of everything appended so far. */
  sync(): Promise<void>;
}

export class Spool {
  /** The planted wrong program's one extra append (`replay-appends-twice`). */
  private doubled = false;
  constructor(private readonly o: SpoolOptions) {}

  /** Whether a spool or a file a failed replay kept is waiting; `kept` counts kept replay files too. */
  waiting(kept: boolean): boolean {
    return existsSync(join(this.o.dir, SPOOL)) || Boolean(kept && existsSync(this.o.dir) && readdirSync(this.o.dir).some((f) => f.endsWith('.jsonl')));
  }

  /**
   * Replays deep-hook's spool: each line once, in the order it was written. A line that doesn't parse, cut by a
   * write that never finished, is skipped and recorded naming its offset, and every request after it is kept,
   * one appended right after the cut bytes included. A file is removed only once its events are in a FULL commit.
   */
  async replay(): Promise<void> {
    const { dir, held, plant } = this.o;
    // One try per host for the pass: a spool of stops from one outage holds later hooks for one try at most.
    const tries = new Map<string, Promise<boolean>>();
    if (!existsSync(dir)) return;
    // Every deep-hook appends to spool.jsonl. It moves aside first, so a hook that spools during the replay begins
    // a new file, which the next replay takes. A hook whose write lands in the moved file sees the path no longer
    // names it and writes the line again to the new one (deep-hook's spool), so nothing written late is lost; the
    // short wait only lets a write in flight finish here rather than read as a cut line.
    const live = join(dir, SPOOL);
    if (existsSync(live)) {
      // Named after every file a replay kept, whatever the clock says now: the files replay in name order.
      const kept = readdirSync(dir).filter((f) => /^replay-[0-9A-HJKMNP-TV-Z]{26}\.jsonl$/.test(f)).sort().at(-1);
      const after = kept ? ulidTime(kept.slice(7, 33)) + 1 : 0;
      const moved = join(dir, `replay-${ulid(Math.max(Date.now(), after))}.jsonl`);
      renameSync(live, moved);
      await new Promise((done) => setTimeout(done, 100));
      // deep-hook syncs spool.jsonl by its name, so a line written just before the move may be synced by no one:
      // the moved file and the move are synced here before any of it is read.
      syncPath(moved);
      syncPath(dir);
    }
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.jsonl') && f !== SPOOL).sort()) {
      const file = join(dir, name);
      const text = readFileSync(file);
      this.o.durable.point('spool_read');
      let failed = false;
      // A cut line is recorded once, however often its kept file is replayed.
      const skip = async (offset: number, reason: string) => {
        try {
          const known = await this.o.raw(`SELECT 1 FROM events WHERE kind = 'spool.refused' AND json_extract(data, '$.file') = ? AND json_extract(data, '$.offset') = ? LIMIT 1`, [name, offset]);
          if (!known.length) await this.o.appendCore('spool.refused', { file: name, offset, reason });
        } catch {
          failed = true;
        }
      };
      for (let offset = 0; offset < text.length;) {
        // A stopping hub keeps the rest of the file for its next start.
        if (this.o.stopping()) {
          failed = true;
          break;
        }
        let end = text.indexOf(0x0a, offset);
        if (end < 0) end = text.length;
        const line = text.subarray(offset, end);
        let parsed = line.length ? parseLine(line, true, held, plant) : undefined;
        if (parsed?.kind === 'refused' && parsed.error.code === 'not_json') {
          await skip(offset, 'a cut line: a spooled write that never finished, so it does not parse');
          if (plant === 'stops-at-first-bad-line') break;
          // A request appended right after the cut bytes shares their line; each begins as deep-hook writes it.
          parsed = undefined;
          for (let at = line.indexOf(REQUEST, 1); at > 0 && !parsed; at = line.indexOf(REQUEST, at + 1)) {
            const glued = parseLine(line.subarray(at), true, held, plant);
            if (glued.kind !== 'refused' || glued.error.code !== 'not_json') parsed = glued;
          }
        }
        if (parsed?.kind === 'hook') {
          const { drafts, meta } = parsed;
          await this.o.tryNetwork(drafts, meta, tries);
          await this.o.replay(drafts, meta).catch((error: unknown) => {
            failed = true;
            process.stderr.write(`deep hub: ${name} kept: ${meta.id} not replayed: ${error instanceof Error ? error.message : String(error)}\n`);
          });
          // The planted wrong program appends the first event it replays a second time, under a new ID.
          if (false && plant === 'replay-appends-twice' && !this.doubled) {
            this.doubled = true;
            const again = ulid(Date.now());
            await this.o.replay(drafts.map((d) => ({ ...d, id: again })), { ...meta, id: again });
          }
        } else if (parsed) {
          await skip(offset, parsed.kind === 'refused' ? `refused: ${parsed.error.code} at ${parsed.error.path || '/'}` : 'not a hook request');
        }
        offset = end + 1;
      }
      if (failed) continue;
      // The planted wrong program removes the file with its events still in NORMAL commits only.
      if (plant !== 'remove-spool-after-normal') await this.o.sync();
      rmSync(file);
      this.o.durable.point('spool_removal');
    }
  }
}
