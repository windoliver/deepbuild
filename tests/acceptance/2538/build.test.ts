// #2538 AC4: the hub's build (`tsc -p packages/hub/tsconfig.json`) fails when a doctor item builder in
// packages/hub/src is given a code doctor.item@1 doesn't list, and its error names that code. The wrong program is a
// planted twin: a copy of the hub's project in a temp folder (helpers.ts, hubTwin) in which three builders, one of
// each shape the issue lists, are given a made-up code in place of a listed one. Both projects are type-checked by
// the repo's tsc with --noEmit; the real source is never edited, and it must check clean, so a hub that doesn't
// build at all can't pass this.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hubTwin, listedCodes, REPO, TSC_TIMEOUT_MS, typeCheck } from './helpers.ts';
import type { Plant, Tsc } from './helpers.ts';

// One builder of each shape the issue compared: an `add(...)` call (doctor.ts, claude.mcp), an `item(...)` call
// (canvas-doctor.ts, canvas.gpu) and an object literal (setup.ts, relationItems). Each made-up code is its own, so
// an error names which builder it came from.
const PLANTS: readonly (Plant & { builder: string })[] = [
  { builder: 'an add(...) call in doctor.ts', file: 'doctor.ts', listed: 'mcp_unregistered', made: 'made_up_code_2538' },
  { builder: 'an item(...) call in canvas-doctor.ts', file: 'canvas-doctor.ts', listed: 'gpu_unsupported', made: 'made_up_item_code_2538' },
  { builder: 'relationItems\' object literal in setup.ts', file: 'setup.ts', listed: 'timing_relation_broken', made: 'made_up_relation_code_2538' },
];

const errorLines = (ran: Tsc): string[] => ran.out.split('\n').filter((line) => /\berror TS\d+:/.test(line));
const shown = (ran: Tsc): string => (ran.out ? ran.out.slice(0, 2000) : '(nothing)');

describe('#2538.aaf41340 AC4: the hub\'s build (`tsc -p packages/hub/tsconfig.json`) fails when a doctor item builder in `packages/hub/src` is given a code `doctor.item@1` doesn\'t list, and its error names that code', () => {
  let real: Tsc;
  let twin: Tsc;
  let root: string | undefined;
  beforeAll(() => {
    real = typeCheck(join(REPO, 'packages', 'hub', 'tsconfig.json'));
    const made = hubTwin(PLANTS);
    root = made.root;
    twin = typeCheck(made.project);
  }, TSC_TIMEOUT_MS);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it('#2538.aaf41340 AC4: the hub\'s own source type-checks clean, and no planted code is one the schema lists', () => {
    expect({ status: real.status, signal: real.signal, out: real.out }).toEqual({ status: 0, signal: null, out: '' });
    const listed = listedCodes();
    for (const plant of PLANTS) {
      expect(listed).toContain(plant.listed);
      expect(listed).not.toContain(plant.made);
    }
  });

  it('#2538.aaf41340 AC4: the twin\'s type-check exits non-zero', () => {
    expect(twin.signal, shown(twin)).toBeNull();
    expect(twin.status, shown(twin)).not.toBe(0);
    expect(twin.status, shown(twin)).not.toBeNull();
    // Nothing but the three planted files fails: an error anywhere else is the twin's own fault, not a finding.
    const elsewhere = errorLines(twin).filter((line) => !PLANTS.some((p) => line.includes(`hub/src/${p.file}(`)));
    expect(elsewhere.slice(0, 5)).toEqual([]);
  });

  it.each(PLANTS)('#2538.aaf41340 AC4: $builder given \'$made\' is a type error in $file that names the code', ({ file, made }) => {
    const named = errorLines(twin).filter((line) => line.includes(`hub/src/${file}(`) && line.includes(made));
    expect(named.length, `no error in packages/hub/src/${file} names "${made}"; tsc printed:\n${shown(twin)}`).toBeGreaterThan(0);
  });
});
