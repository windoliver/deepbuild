// Spike #245's rule (canvas primitives: Logic: step blocks): which form the app runs step blocks
// in, from the spike's record. copy_on_write only on a reference Mac under a timing's conditions,
// for the 8,000-agent fixture at 60 Hz with 8 blocks, when its step's wall time on 4 threads is at
// most half one_instance's at both p50 and p95 and its mapping and page-fault overhead is under
// 0.3 ms a step at p95. Anything missing, malformed or off those conditions is one_instance.

const REFERENCE_MACS = ['Mac15,7', 'Mac15,12', 'Mac17,10'];
const THREADS = { one_instance: 1, copy_on_write: 4 };
const MIN_STEPS = 300;

const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const finite = (x) => typeof x === 'number' && Number.isFinite(x);

function timed(form, threads) {
  if (!object(form) || form.threads !== threads) return false;
  if (!Number.isInteger(form.steps) || form.steps < MIN_STEPS) return false;
  if (!object(form.wall_ms) || !object(form.overhead_ms)) return false;
  const { p50: w50, p95: w95 } = form.wall_ms;
  const { p50: o50, p95: o95 } = form.overhead_ms;
  return [w50, w95, o50, o95].every(finite) && w50 > 0 && w50 <= w95 && o50 >= 0 && o50 <= o95;
}

/** "copy_on_write" or "one_instance", from the record's numbers; never its stored verdict. */
export function verdict(record) {
  if (!object(record) || !object(record.host) || !object(record.fixture) || !object(record.forms)) return 'one_instance';
  const { host, fixture, forms } = record;
  const reference = REFERENCE_MACS.includes(host.model) && host.os === 'macOS'
    && typeof host.os_build === 'string' && host.os_build.trim() !== ''
    && host.power === 'ac' && host.low_power_mode === false && host.thermal === 'nominal';
  if (!reference) return 'one_instance';
  if (fixture.agents !== 8000 || fixture.rate_hz !== 60 || fixture.blocks !== 8) return 'one_instance';
  if (!Object.entries(THREADS).every(([name, threads]) => timed(forms[name], threads))) return 'one_instance';
  const one = forms.one_instance;
  const cow = forms.copy_on_write;
  const half = cow.wall_ms.p50 <= 0.5 * one.wall_ms.p50 && cow.wall_ms.p95 <= 0.5 * one.wall_ms.p95;
  return half && cow.overhead_ms.p95 < 0.3 ? 'copy_on_write' : 'one_instance';
}
