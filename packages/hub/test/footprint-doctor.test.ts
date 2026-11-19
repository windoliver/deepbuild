// #1431: `deep doctor`'s app.footprint item. The app's reading splits its footprint into the heap, the gauges and what's
// unaccounted; a value that couldn't be read shows as unknown, naming the read, never as 0, and the item warns; with no
// app answering it isn't checked.
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { appFootprintItem, footprintItem } from '../src/footprint-doctor.ts';

const READ = 'proc_pid_rusage(RUSAGE_INFO_V2).ri_phys_footprint';
const gauges = [{ name: 'Renderer::meshes', on: 'device', bytes: 4_000, entries: 3 }, { name: 'CanvasPanel::pictures', on: 'heap', bytes: 1_000, entries: 1 }];
const known = { footprint: 100_000, heap: 60_000, gauges, unaccounted: 35_000, device: 9_000, unknown: [], gauges_ms: 0.01 };

it('a reading whose every value is known is healthy, its footprint split into the heap, each gauge and unaccounted', () => {
  const item = footprintItem({ reading: known, minutes: [{}, {}, {}], unaccounted_mean: 34_000, void_minutes: 1 });
  expect(item).toMatchObject({ item: 'app.footprint', agent: 'deepbuild', code: 'healthy', level: 'ok' });
  expect(item.evidence).toContain('footprint 100000 B = heap 60000 B + gauges 5000 B (Renderer::meshes 4000 B, CanvasPanel::pictures 1000 B) + unaccounted 35000 B');
  expect(item.evidence).toContain('unaccounted averaged 34000 B, 1 void minutes left out');
});

it('a footprint that couldn\'t be read is unknown, naming its read, never 0, and so is unaccounted; the item warns', () => {
  const reading = { ...known, footprint: null, unaccounted: null, unknown: [{ field: 'footprint', read: READ, error: 'returned -1' }] };
  const item = footprintItem({ reading, minutes: [] });
  expect(item).toMatchObject({ code: 'footprint_unknown', level: 'warn' });
  expect(item.evidence).toContain(`footprint unknown (${READ}) = heap 60000 B`);
  expect(item.evidence).toContain(`unaccounted unknown (${READ})`);
  expect(item.evidence).not.toMatch(/footprint 0 B/);
});

it('asks the app on its socket, and with no app answering the item isn\'t checked', async () => {
  const home = mkdtempSync(join(tmpdir(), 'footprint-doctor-'));
  try {
    expect(await appFootprintItem({ HOME: home })).toMatchObject({ code: 'not_checked', level: 'skip' });
    mkdirSync(join(home, '.deepbuild'));
    const server = createServer((socket) => socket.once('data', (line) => {
      expect(String(line)).toBe('footprint\n');
      socket.end(`${JSON.stringify({ reading: known, minutes: [] })}\n`);
    }));
    await new Promise<void>((done) => server.listen(join(home, '.deepbuild', 'app.sock'), done));
    try {
      expect(await appFootprintItem({ HOME: home })).toMatchObject({ code: 'healthy', level: 'ok' });
    } finally {
      server.close();
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
