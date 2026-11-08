// The panel module's load path, for the perf lane's budgets (issue #1425): node benchmarks/panel-module.mjs. Each of the
// 12 panels in crates/deep-app/panels runs in `target/debug/deep-panel-host run`, which loads it through the app's
// loader (the module check, then @deepbuild/panel written where gpui-shell resolves it) and updates it 20 times. Prints
// each panel's slowest update as one JSON line; a panel the host refuses fails the run.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const HOST = join(REPO, 'target', 'debug', 'deep-panel-host');
const PANELS = join(REPO, 'crates', 'deep-app', 'panels');

if (!existsSync(HOST)) execFileSync('cargo', ['build', '--locked', '-q', '-p', 'deep-panel-host', '--bin', 'deep-panel-host'], { cwd: REPO, stdio: 'inherit' });
const out = mkdtempSync(join(tmpdir(), 'deep-panel-module-'));
const slowestMs = {};
try {
  for (const panel of readdirSync(PANELS).filter((name) => existsSync(join(PANELS, name, 'main.js'))).sort()) {
    const report = join(out, `${panel}.json`);
    const run = spawnSync(HOST, ['run', '--panel', join(PANELS, panel), '--renders', '20', '--out', report], { encoding: 'utf8' });
    if (run.status !== 0) throw Error(`deep-panel-host refused ${panel}: ${run.stderr}`);
    slowestMs[panel] = Math.max(...JSON.parse(readFileSync(report, 'utf8')).renderNs) / 1e6;
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log(JSON.stringify({ slowestMs }));
