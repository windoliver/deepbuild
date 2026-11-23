// The port@1 kit holds every port to its rule whatever the port lists: what the piece lists, and nothing else, goes
// out as it plays live; a seek, a replay or an export sends nothing.
import { describe, expect, it } from 'vitest';
import { runKit, slotKits } from '../index.js';
import type { PortFill } from './port.js';

const kit = slotKits().find((k) => k.slot === 'port@1')!;
type Moment = Parameters<PortFill['send']>[0];
const port = (entries: string[], rows: string[], sends: (m: Moment, listed: string[]) => boolean): PortFill =>
  ({ slot: 'port@1', revision: 1, name: 'mixer', entries, rows, send: (m) => (sends(m, [...entries, ...rows]) ? [{ name: m.name, value: m.value }] : []) });
const live = (m: Moment, listed: string[]): boolean => m.play === 'live' && listed.includes(m.name);
const verdict = async (fill: PortFill): Promise<string> => (await runKit(kit, fill, { seed: 7 })).verdict;

describe('the port@1 kit', () => {
  it('passes a correct port that lists other names, only rows, or nothing', async () => {
    expect(await verdict(port(['volume', 'pan'], ['notes'], live))).toBe('PASS');
    expect(await verdict(port([], ['notes'], live))).toBe('PASS');
    expect(await verdict(port([], [], live))).toBe('PASS');
  });
  it('refuses a port that lists only rows and sends them on a seek', async () => {
    expect(await verdict(port([], ['notes'], (m, l) => (m.play === 'live' || m.play === 'seek') && l.includes(m.name)))).toBe('FAIL');
  });
  it('refuses a port that sends its second entry on a replay, or drops it live', async () => {
    expect(await verdict(port(['volume', 'pan'], [], (m, l) => live(m, l) || (m.play === 'replay' && m.name === 'pan')))).toBe('FAIL');
    expect(await verdict(port(['volume', 'pan'], [], (m, l) => live(m, l) && m.name !== 'pan'))).toBe('FAIL');
  });
});
