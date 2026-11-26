// panel@1's rules on reading and reach, for the perf lane's budgets (issue #3233): node benchmarks/panel-rules.mjs.
// One `target/debug/deep-app panel-bench` run of a fresh panel host on a 500-node panel that passes revision 2 and
// gives each rule its most work: 249 rows, each a div that takes a press and focus, holds its own text and sets that
// text's color on the root's fill. Prints the slowest of 100 updates' rules, in ms, as one JSON line; a bench that
// reports no time for them fails the run.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const [APP, HOST] = ['deep-app', 'deep-panel-host'].map((bin) => join(REPO, 'target', 'debug', bin));
const UPDATES = 100;
const PANEL = `import { View, div, v_flex } from "@deepbuild/panel";

export default class Rows extends View {
  init(_props, cx) {
    this.handles = Array.from({ length: 249 }, () => cx.focus_handle());
  }

  render() {
    let rows = v_flex().size_full().bg("#ffffff").child(div());
    for (const [at, handle] of this.handles.entries()) {
      rows = rows.child(div().id(\`row-\${at}\`).track_focus(handle).text_color("#595959").on_click(() => {}).child(\`Row \${at}\`));
    }
    return rows;
  }
}
`;

// Always asked of cargo, which builds nothing when both are fresh: a deep-app built without panel-check would open the app.
execFileSync('cargo', ['build', '--locked', '-q', '-p', 'deep-panel-host', '-p', 'deep-app', '--features', 'deep-app/panel-check'], { cwd: REPO, stdio: 'inherit' });
const dir = mkdtempSync(join(tmpdir(), 'deep-panel-rules-'));
try {
  writeFileSync(join(dir, 'main.js'), PANEL);
  const report = join(dir, 'bench.json');
  const run = spawnSync(APP, ['panel-bench', '--host', HOST, '--panel', dir, '--origin', 'agent_built', '--runs', '1', '--updates', String(UPDATES), '--out', report], { encoding: 'utf8' });
  if (run.status !== 0) throw Error(`deep-app panel-bench failed on the 500-node panel: ${run.stderr}`);
  const rulesNs = JSON.parse(readFileSync(report, 'utf8')).runs[0].rulesNs;
  if (!Array.isArray(rulesNs) || rulesNs.length !== UPDATES || rulesNs.some((ns) => !(ns > 0))) throw Error(`panel-bench reports no time for the rules on each of ${UPDATES} updates: ${JSON.stringify(rulesNs)}`);
  console.log(JSON.stringify({ slowestMs: Math.max(...rulesNs) / 1e6 }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
