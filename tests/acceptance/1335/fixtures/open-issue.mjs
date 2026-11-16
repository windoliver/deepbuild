// `open-issue`, the one behavior this suite adds to #1332's played agent (tests/acceptance/1332/fixtures/agent.mjs;
// helpers.ts installs that agent with one dispatch line that imports this module). The session opens the issue its
// plan names (`opens`: title, body, labels) through the forge's REST API with its own GH_TOKEN, as one Bash call its
// hooks see, the way the played agent opens its pull request; then it works on the test's go, as `gated` does.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function openIssue({ opens, api, repo, issue, dir, bash, q, step, work }) {
  const payload = JSON.stringify({ title: opens.title, body: opens.body, labels: opens.labels ?? [] });
  const code = await bash(`curl -sS -f -X POST -H "Authorization: Bearer $GH_TOKEN" -H 'Accept: application/vnd.github+json' -d ${q(payload)} ${q(`${api}/repos/${repo}/issues`)}`);
  step('opened an issue', { code });
  while (!existsSync(join(dir, `go-${issue}`))) await new Promise((r) => setTimeout(r, 200));
  step('go');
  await work();
}
