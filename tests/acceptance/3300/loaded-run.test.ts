// #3300 criterion 2: "A redrafted made-up reading whose run 3 starts at a load above the core count reads
// INCONCLUSIVE, naming the load"
//
// Each reading the redrafts make up for `node benchmarks/canvas.mjs judge` within every target (the six of the issue's
// table), judged as the redraft makes it, reads PASS; the same reading with run 3's `loadStart` at 4096, above the core
// count of any machine that judges it, reads INCONCLUSIVE, its reason naming the load (`load 4096`). judgeLimit holds a
// load against the cores of the machine it runs on, so 4096 is above them on every Mac. README: Criterion 2. The wrong
// programs: a judge that ignores the loads (twins/judge-ignores-loads), which reads the loaded reading PASS; a redraft
// whose made-up runs give no loads, which reads the at-rest reading INCONCLUSIVE too, naming no load above the cores.
import { expect, test } from 'vitest';
import { judged, obj, str, synthetic, type JsonObject, type JsonValue } from '../854/redraft-3300/helpers.ts';
import { dirtyReading, settledReading } from '../896/redraft-3300/helpers.ts';
import { AC2 } from './helpers.ts';

/** A one-minute load above the cores of any machine that judges a reading: judgeLimit reads the cores where it runs. */
const LOADED = 4096;

const READINGS: { name: string; make: () => JsonObject }[] = [
  { name: '854 patch', make: () => synthetic('patch') },
  { name: '854 scene read', make: () => synthetic('read') },
  { name: '854 idle', make: () => synthetic('idle') },
  { name: '854 replica', make: () => synthetic('replica') },
  { name: '896 settled', make: () => settledReading(() => ({ ms: 1 })) },
  { name: '896 dirty', make: () => dirtyReading(() => ({ ms: 1, bytes: 48 })) },
];

test.each(READINGS)(`${AC2} the redrafted made-up reading of $name within every target reads PASS at rest, and INCONCLUSIVE naming the load when its run 3 starts at a load above the core count`, ({ make }) => {
  const rest = judged(make());
  expect(rest['status'], `the redrafted reading, every run at rest, passes: ${JSON.stringify(rest).slice(0, 2000)}`).toBe('PASS');
  const reading = make();
  const runs = reading['runs'] as JsonValue[];
  runs[2] = { ...obj(runs[2], 'run 3'), loadStart: LOADED };
  const verdict = judged(reading);
  const shown = JSON.stringify(verdict).slice(0, 3000);
  expect(verdict['status'], `run 3 starting at load ${LOADED} reads INCONCLUSIVE: ${shown}`).toBe('INCONCLUSIVE');
  expect(str(verdict['reason'], 'verdict.reason'), `the reason names the load, ${LOADED}, above the cores: ${shown}`).toMatch(RegExp(`\\bload ${LOADED}\\b[^|]*\\bcores\\b`));
}, 600_000);
