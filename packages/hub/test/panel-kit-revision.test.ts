// #3233: what the hub keeps of a panel's kit. A panel that takes a press with no name is refused as a new package,
// and passes when the hub says it was installed against revision 1, with what the current revision would refuse in
// it as a reading for its listing. A package's own record of an earlier install is never honoured. It runs the
// checkout's replica, as `deep install` does; unbuilt, the kit reads BLOCKED and every expectation here fails.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { panelKit } from '../src/panels.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const NAMELESS = `import { View, div, v_flex } from "@deepbuild/panel";

export default class Nameless extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
  }

  render() {
    return v_flex().size_full().child(div().id("refresh-control").w(120).h(28).track_focus(this.handle).on_click(() => {}));
  }
}
`;
let panel = '';

beforeAll(() => {
  execFileSync('cargo', ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-replica'], { cwd: REPO, stdio: 'ignore', env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
  panel = mkdtempSync(join(tmpdir(), 'deep-panel-kit-revision-'));
  writeFileSync(join(panel, 'main.js'), NAMELESS);
}, 3_600_000);
afterAll(() => rmSync(panel, { recursive: true, force: true }));

test('a new package is held to the kit\'s current revision, and one installed against revision 1 passes with a reading', async () => {
  const fresh = await panelKit(panel);
  expect([fresh.verdict, fresh.revision], fresh.why).toEqual(['FAIL', 2]);
  expect(fresh.why).toMatch(/\bno_name\b.*refresh-control/);

  const installed = await panelKit(panel, 1);
  expect([installed.verdict, installed.revision], installed.why).toEqual(['PASS', 1]);
  expect(installed.reading).toMatch(/\bno_name\b.*refresh-control/);
}, 120_000);

test('a package\'s own record of an earlier install is not honoured', async () => {
  writeFileSync(join(panel, 'panel-kit.json'), JSON.stringify({ slot: 'panel@1', revision: 1 }));
  try {
    const fresh = await panelKit(panel);
    expect([fresh.verdict, fresh.revision], fresh.why).toEqual(['FAIL', 2]);
  } finally {
    rmSync(join(panel, 'panel-kit.json'), { force: true });
  }
}, 120_000);
