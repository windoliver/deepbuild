// Pure judgments for issue #2332's three criteria. Nothing here starts a process.
//
// The statistic is the perf lane's (scripts/benchmark.mjs judgeInstructions, design #perf): per pair the log
// ratio ln(current / base) less ln(limit), summed, read against 10,000 seeded sign flips of the same values.
// The lane's 2% floor is replaced by the issue's own limits: 0.75 for start to ready (at least 25% under main)
// and 1 for the first hook replies and idle memory (0% allowed increase).
//   FAIL          the flips reach the pairs' own sum at p < 0.01: above the limit is shown
//   PASS          the flips fall to it at p < 0.01 and the median pair is within the limit: within is shown
//   INCONCLUSIVE  anything else, including too few pairs and any missing count. Not seeing a rise is not PASS.
const ALPHA = 0.01, FLIPS = 10_000, SEED = 1405, MIN_PAIRS = 20;

function words(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    const h = Math.imul(state ^ (state >>> 16), 0x85ebca6b);
    const k = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (k ^ (k >>> 16)) >>> 0;
  };
}
const positive = (value) => Number.isSafeInteger(value) && value > 0;

/** pairs: [{ current, base }] in alternated rounds. limit: the largest allowed current / base. */
export function judge(pairs, limit, { seed = SEED, minPairs = MIN_PAIRS } = {}) {
  const out = { status: 'INCONCLUSIVE', pairs: pairs.length, limit, seed, medianDelta: null, pAbove: null, pBelow: null };
  if (pairs.length < minPairs) return { ...out, reason: `${pairs.length} of the ${minPairs} required alternated pairs` };
  const missing = pairs.filter((pair) => !positive(pair?.current) || !positive(pair?.base)).length;
  if (missing) return { ...out, reason: `a count is missing or zero in ${missing} of ${pairs.length} pairs` };
  const deltas = pairs.map(({ current, base }) => current / base - 1).sort((a, b) => a - b);
  const mid = deltas.length / 2;
  const medianDelta = deltas.length % 2 ? deltas[Math.floor(mid)] : (deltas[mid - 1] + deltas[mid]) / 2;
  const shifted = pairs.map(({ current, base }) => (Math.abs(current - base * limit) <= 1 ? 0 : Math.log(current / base) - Math.log(limit)));
  const observed = shifted.reduce((sum, value) => sum + value, 0);
  const tolerance = 1e-9 * shifted.reduce((sum, value) => sum + Math.abs(value), 0);
  const next = words(seed);
  let above = 1, below = 1;
  for (let flip = 0; flip < FLIPS; flip++) {
    let total = 0, bits = 0;
    for (let index = 0; index < shifted.length; index++) {
      if (index % 32 === 0) bits = next();
      total += (bits >>> (index % 32)) & 1 ? shifted[index] : -shifted[index];
    }
    if (total >= observed - tolerance) above++;
    if (total <= observed + tolerance) below++;
  }
  const pAbove = above / (FLIPS + 1), pBelow = below / (FLIPS + 1);
  const read = { ...out, medianDelta, pAbove, pBelow };
  const text = `median ${(medianDelta * 100).toFixed(2)}% of ${pairs.length} pairs; p ${pAbove.toPrecision(2)} above limit ${limit}, p ${pBelow.toPrecision(2)} within it`;
  if (pAbove < ALPHA) return { ...read, status: 'FAIL', reason: `above the limit: ${text}` };
  if (pBelow < ALPHA && medianDelta <= limit - 1) return { ...read, status: 'PASS', reason: text };
  return { ...read, status: 'INCONCLUSIVE', reason: `cannot tell within the limit from above it: ${text}` };
}

export const REFERENCE_MACS = [
  { name: 'Mac15,7 (M3 Pro, 36 GB)', model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30 },
  { name: 'Mac15,12 (M3, 16 GB)', model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30 },
  { name: 'Mac17,10 (M5 Max, 64 GB)', model: 'Mac17,10', chip: 'Apple M5 Max', memoryBytes: 64 * 2 ** 30 },
];

/** null when the fingerprint (scripts/benchmark.mjs fingerprint, read from the OS) is a named reference Mac on AC,
 * Low Power Mode off, thermal nominal; otherwise why not. A field the OS could not report is a reason. */
export function offReference(fp) {
  if (!fp) return 'no fingerprint';
  const mac = REFERENCE_MACS.find(({ model, chip, memoryBytes }) => fp.model === model && fp.chip === chip && fp.memoryBytes === memoryBytes);
  const why = [];
  if (!mac) why.push(`${fp.model ?? '?'} / ${fp.chip ?? '?'} is not a reference Mac`);
  if (fp.power !== 'ac') why.push(`power ${fp.power ?? 'unread'}`);
  if (fp.lowPowerMode !== false) why.push(`Low Power Mode ${fp.lowPowerMode === null || fp.lowPowerMode === undefined ? 'unread' : 'on'}`);
  if (fp.thermalState !== 'nominal') why.push(`thermal ${fp.thermalState ?? 'unread'}`);
  return why.length ? why.join('; ') : null;
}

/** Memory is judged only when every run's fingerprint is a reference Mac, the same machine throughout. */
export function judgeMemory(pairs, fingerprints, options) {
  const off = fingerprints.map(offReference).find(Boolean);
  const same = new Set(fingerprints.map((fp) => `${fp?.model}|${fp?.chip}|${fp?.memoryBytes}`)).size <= 1;
  const result = judge(pairs, 1, options);
  if (!fingerprints.length || fingerprints.length < pairs.length * 2) return { ...result, status: 'INCONCLUSIVE', reason: `fingerprints missing for ${pairs.length * 2 - fingerprints.length} runs; ${result.reason}` };
  if (off) return { ...result, status: 'INCONCLUSIVE', reason: `off the reference Mac (${off}); ${result.reason}` };
  if (!same) return { ...result, status: 'INCONCLUSIVE', reason: `runs were on different machines; ${result.reason}` };
  return result;
}

/** What a hook's reply has to look like for a call to count: the hub's line { exit, stdout, stderr }. */
export function usableReply(reply, expect = {}) {
  if (!reply || typeof reply !== 'object' || !Number.isInteger(reply.exit) || typeof reply.stdout !== 'string' || typeof reply.stderr !== 'string') return 'not a hook reply line';
  if (expect.exit !== undefined && reply.exit !== expect.exit) return `exit ${reply.exit}, wanted ${expect.exit}`;
  if (expect.stderr && !reply.stderr.includes(expect.stderr)) return `stderr lacks "${expect.stderr}"`;
  return null;
}

/** The perf lane's count-children.c log, for the hub's own pid: its children, apart from its own count. */
export function childrenOf(log, hubPid) {
  const rows = log.split('\n').filter(Boolean).map((line) => line.split(' '));
  const own = String(hubPid);
  const reaped = rows.filter(([kind, parent]) => kind === 'reap' && parent === own);
  const started = rows.filter(([kind, parent]) => kind === 'start' && parent === own).map(([, , , ...path]) => path.join(' '));
  const self = rows.find(([kind, pid]) => kind === 'exit' && pid === own);
  return {
    started,
    reapedCount: reaped.length,
    instructions: reaped.reduce((sum, row) => sum + Number(row[3]), 0),
    ownAtExit: self ? Number(self[2]) : null,
    unread: rows.filter(([kind, parent]) => kind === 'unread' && parent === own).length,
  };
}
