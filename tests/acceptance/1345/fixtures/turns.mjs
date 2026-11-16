// The two turns this suite adds to #1332's played agent (tests/acceptance/1332/fixtures/agent.mjs; helpers.ts installs
// that agent with two dispatch lines that import this module). Each first thinks for THINK_MS, as a model does before
// its first call, so the session's start reaches the hub before its push does: under load deep-hook can spool a
// session's first hooks, and a push the hub sees before it knows the session is a run's is held for your authority
// (README: What the base does). Then:
// - `slow` works as `work` does: `src/i<n>.txt`, a commit, a push of its branch and a pull request that says
//   `Closes #<n>`, with the session's own GH_TOKEN;
// - `page` first writes `docs/i<n>.md`, in the folder the repo's Pages site is built from, as one Write call its hooks
//   see, and stages it with one Bash call, so the same commit holds both files.
const THINK_MS = 20_000;
const think = async (step) => { await new Promise((r) => setTimeout(r, THINK_MS)); step('thought'); };

export async function slow({ step, work }) {
  await think(step);
  await work();
}

export async function page({ issue, writeFile, bash, q, step, work }) {
  await think(step);
  const path = `docs/i${issue}.md`;
  await writeFile(path, `# The shop does ${issue}\n`);
  await bash(`git add ${q(path)}`);
  step('wrote the page', { path });
  await work();
}
