// What #2123's acceptance tests share (README): each criterion's tag, and a wait that polls for an outcome. The worlds
// themselves are the neighbouring suites', imported where each test needs one: nothing here stands in for DeepBuild.

/**
 * Each criterion's tag: `#2123.` and the first 8 hex digits of the SHA-256 of its `- [ ]` line's text, whitespace
 * collapsed, as `criteria()` in packages/hub/src/acceptance.ts makes it. In the issue's order.
 */
export const AC = {
  wiki: '#2123.6e6ae79d',
  channel: '#2123.8ad68fab',
  fetch: '#2123.4627e131',
  thumbnail: '#2123.f6e57c22',
  threads: '#2123.68e68bf4',
  dispute: '#2123.750aef7f',
} as const;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `probe` until it answers something or `ms` pass: its answer, or undefined at the deadline, for the test's own assertion to judge. */
export async function eventually<T>(probe: () => Promise<T | undefined> | T | undefined, ms: number, every = 100): Promise<T | undefined> {
  for (const end = Date.now() + ms; ;) {
    const value = await probe();
    if (value !== undefined || Date.now() >= end) return value;
    await sleep(every);
  }
}
