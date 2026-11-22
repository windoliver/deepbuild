// Throwaway archive for the probe's under-count proof of a peak that no sample can see (round 2, Defect 1). Not
// part of the acceptance suite. Loaded by tests/acceptance/2365/probe/pass.mjs through its --archive flag.
// Its pass, in ONE synchronous step (so the probe's 5 ms timer cannot run during it): makes a WebAssembly.Memory of
// 1,526 pages (100,007,936 bytes), writes every byte so it is resident, drops it, collects, and spins until the
// process's own reading has fallen back to within 20 MB of where the step began (2 s at most). A Buffer would not
// do: once dropped its pages stay resident, so the timer would still sample them. Then the pass waits 100 ms, so
// the timer does sample the process after the peak has gone. What it read goes to stderr.
// The memory the pass added, at its peak, is at least 100 MB; only the process's lifetime maximum can show it.
export async function openArchive() {
  const rss = () => process.memoryUsage.rss();
  const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
  const spike = async () => {
    const before = rss();
    const held = (() => { const memory = new WebAssembly.Memory({ initial: 1526 }); new Uint8Array(memory.buffer).fill(1); return rss(); })();
    globalThis.gc?.();
    const t = performance.now();
    while (rss() - before > 20_000_000 && performance.now() - t < 2000) { /* the memory is released off this thread */ }
    process.stderr.write(`   alloc-100mb-transient: rss() ${mb(before)} before, ${mb(held)} while held, ${mb(rss())} when the same synchronous step ended\n`);
    await new Promise((done) => setTimeout(done, 100));
  };
  return { pass: spike, session: spike, archived: () => [] };
}
