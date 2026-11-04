// #45 AC16 on the record #965's gate runner writes: one `check.held@1` per held place, appended again, whole, each time
// it changes, so the newest record for a check and snapshot stands.
import { describe, expect, it } from 'vitest';
import { loopHolds, type RecordEvent } from '../src/index.js';

const MIN = 60_000;
let n = 0;
interface Place { claim: string; check: string; snapshot: string; held_at: number; reason: string; started_at: number | null; started_by: string | null; replaced_by: string | null }
const held = (ts: number, p: Place): RecordEvent => ({ id: `e${n++}`, kind: 'check.held', v: 1, ts, session: null, subject: p.claim, data: { session: 'session:S16', ...p } });

describe('checks held for a loop, from check.held as the gate runner appends it', () => {
  it('held through three goal turns, each newer snapshot taking its place, then started by the loop\'s pause: three places taken, three runs saved, one start, 45 s from its stop', () => {
    const at = (i: number) => i * 10 * MIN;
    const place = (i: number): Place => ({ claim: `claim:C${i}`, check: 'journey', snapshot: `s${i}`, held_at: at(i), reason: 'continuation', started_at: null, started_by: null, replaced_by: null });
    const events: RecordEvent[] = [held(at(0), place(0))];
    for (let i = 1; i <= 3; i++) events.push(held(at(i), { ...place(i - 1), replaced_by: `s${i}` }), held(at(i), place(i)));
    events.push(held(at(3) + 45_000, { ...place(3), started_at: at(3) + 45_000, started_by: 'loop_paused' }));

    const [s] = loopHolds(events).sessions;
    expect(s?.session).toBe('S16');
    expect(s?.places_taken, 'each older snapshot\'s place, taken by the next').toBe(3);
    expect(s?.runs_saved).toBe(3);
    expect(s?.runs_started, 'counting held records as runs reads 8').toBe(1);
    expect(s?.starts).toEqual([{ check: 'journey', claim: 'claim:C3', by: 'loop_paused', waited_ms: 45_000 }]);
  });

  it('a place still held reads no start, and a place started before a newer snapshot came reads no place taken', () => {
    const p: Place = { claim: 'claim:A', check: 'e2e', snapshot: 'a', held_at: 0, reason: 'cron', started_at: null, started_by: null, replaced_by: null };
    const q: Place = { ...p, claim: 'claim:B', snapshot: 'b', held_at: MIN };
    const events = [held(0, p), held(30_000, { ...p, started_at: 30_000, started_by: 'words' }), held(MIN, q)];
    const [s] = loopHolds(events).sessions;
    expect(s?.places_taken).toBe(0);
    expect(s?.runs_started).toBe(1);
    expect(s?.starts).toEqual([{ check: 'e2e', claim: 'claim:A', by: 'words', waited_ms: 30_000 }]);
  });
});
