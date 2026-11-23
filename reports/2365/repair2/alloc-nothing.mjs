// Throwaway archive for the probe's over-count proof (round 2, Defect 1). Not part of the acceptance suite.
// Loaded by tests/acceptance/2365/probe/pass.mjs through its --archive flag. Its pass allocates almost nothing:
// it waits 300 ms, so the memory the pass added is close to zero.
export async function openArchive() {
  const idle = () => new Promise((done) => setTimeout(done, 300));
  return { pass: idle, session: idle, archived: () => [] };
}
