import { expect } from 'vitest';
import { checkCall, onLogic } from '../533/helpers.ts';
import { assemble, type Obj } from '../556/helpers.ts';
import { ID, PROBE_TEXT, READS_AT, STATE, WRITES_AT, crawlerText, pieceOf, type Twin } from './crawler.ts';

export * from './crawler.ts';

interface Entry { region: string; name: string; offset: number; size: number }

let layout: Entry[] | undefined;
function layoutOf(): Entry[] {
  if (layout) return layout;
  const [reply] = onLogic([checkCall(pieceOf(assemble('probe3264', PROBE_TEXT)) as never)]) as Obj[];
  expect(reply?.['ok'], `deep-logic check takes the crawler's layout probe: ${JSON.stringify(reply).slice(0, 1500)}`).toBe(true);
  const entries = reply!['items'][ID]['layout']['entries'] as Entry[];
  const end = (region: string): number => Math.max(0, ...entries.filter((e) => e.region === region).map((e) => e.offset + e.size));
  expect(READS_AT + end('reads'), 'the read region ends before writes_at').toBeLessThanOrEqual(WRITES_AT);
  expect(WRITES_AT + end('writes'), 'the write region ends before the program\'s own state').toBeLessThanOrEqual(STATE);
  layout = entries;
  return entries;
}
function offsetOf(region: 'reads' | 'writes', name: string): number {
  const e = layoutOf().find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the layout has no ${region} entry ${name}: ${JSON.stringify(layoutOf())}`);
  return (region === 'reads' ? READS_AT : WRITES_AT) + e.offset;
}

export function crawlerPiece(v: Twin): Obj {
  const AIM = offsetOf('reads', 'aim');
  const WAIT = offsetOf('reads', 'wait_key');
  const W = (name: string): number => offsetOf('writes', name);
  return pieceOf(assemble(`crawler3264_${v}_${AIM}_${WAIT}_${W('grid')}`, crawlerText(v, AIM, WAIT, W)));
}
