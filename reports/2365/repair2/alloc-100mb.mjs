// Throwaway archive for the probe's under-count proof (round 2, Defect 1). Not part of the acceptance suite.
// Loaded by tests/acceptance/2365/probe/pass.mjs through its --archive flag. Its pass allocates a buffer of
// 100,000,000 bytes, writes every page of it so it is resident, holds it for HOLD_MS (default 300 ms; with 0 it is
// dropped in the same synchronous step), then drops it. The memory the pass added is at least 100 MB.
// Measured here: a dropped Buffer's pages stay resident on both Node builds, so even with HOLD_MS=0 the probe's
// timer samples them afterwards. The peak that no sample can see is alloc-100mb-transient.mjs.
const BYTES = 100_000_000;
const HOLD_MS = Number(process.env.HOLD_MS ?? 300);
export async function openArchive() {
  const hold = async () => {
    let buffer = Buffer.allocUnsafeSlow(BYTES);
    buffer.fill(1);
    if (HOLD_MS > 0) await new Promise((done) => setTimeout(done, HOLD_MS));
    const sum = buffer[0] + buffer[BYTES - 1];
    buffer = null;
    globalThis.gc?.();
    return void sum;
  };
  return { pass: hold, session: hold, archived: () => [] };
}
