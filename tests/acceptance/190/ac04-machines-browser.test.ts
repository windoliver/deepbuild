// Criterion 4 (no upstream test): "The two pieces' merged programs are byte for byte the same on macOS arm64 and
// Linux x86_64, and grid_path@1's fixtures give the same full-state hashes in the app and in headless Chrome's own
// WebAssembly engine"
//
// Through `deep-logic check` on this host (which must be macOS arm64) and in a linux/amd64 container, and the web
// runner (`web_plan`, `web_runner`) in headless Chrome (README: deep-logic, Fixture). The merged programs are the
// receipts' `linked` bytes. A fixture's full-state hashes are those its receipt records (`deep_hashes`, the fixture
// item's checkpoints); the app's bake of the fixture's piece and Chrome's bake of `web_plan`'s request must give them.
import { describe, expect, it } from 'vitest';
import { ABOUT, AC, TIMEOUT, WEB_RUNNER, admitted, bakeCall, bakeOf, checkCall, cps, firstDiff, fixturePiece, inChrome, logicBin, obj, onHost, onLinux, prebuild, requireMacArm64, str, webPlanCall } from './helpers.ts';
import { chasePiece, gridPath1, mazePiece, pack } from './libs.ts';

prebuild(() => { logicBin(); });

describe(`${AC[4]} the merged programs and the fixtures' hashes are the same on every host`, () => {
  it(`${AC[4]} the two pieces' merged programs are byte for byte the same on macOS arm64 and Linux x86_64`, () => {
    const lib = gridPath1();
    const packs = [pack('gridcore', [lib])];
    const calls = [checkCall(mazePiece(lib, packs)), checkCall(chasePiece(lib, packs))];
    const here = onHost(calls);
    const mine = [admitted(here[0]!, 'check of maze')['maze']!.linked, admitted(here[1]!, 'check of chase')['chase']!.linked];
    expect(mine.every((m) => m !== null), 'both receipts carry their merged programs').toBe(true);
    requireMacArm64('the first machine of the comparison');
    const [about, ...linux] = onLinux([ABOUT, ...calls]);
    expect(about!['arch'], 'the second machine is Linux x86_64').toBe('x86_64');
    const theirs = [admitted(linux[0]!, 'Linux x86_64\'s check of maze')['maze']!.linked, admitted(linux[1]!, 'Linux x86_64\'s check of chase')['chase']!.linked];
    for (const [i, id] of ['maze', 'chase'].entries()) {
      expect(theirs[i]?.sha256, `${id}'s merged program has the same sha256 on Linux x86_64`).toBe(mine[i]!.sha256);
      expect(Buffer.compare(theirs[i]!.bytes, mine[i]!.bytes), `${id}'s merged program is byte for byte the same`).toBe(0);
    }
  }, TIMEOUT);

  it(`${AC[4]} grid_path@1's fixtures give the same full-state hashes in the app and in headless Chrome's own WebAssembly engine`, async () => {
    const lib = gridPath1();
    const packs = [pack('gridcore', [lib])];
    for (const f of lib.fixtures) {
      const p = fixturePiece(lib, f, packs);
      const [check, bake, runner, plan] = onHost([checkCall(p), bakeCall(p, f.steps, f.track ?? []), WEB_RUNNER, webPlanCall(p, f.steps, f.track ?? [])]);
      const run = admitted(check!, 'check of the fixture item')['fixture']!.libraries.find((l) => l.name === 'grid_path@1')?.fixtures[0];
      expect(run?.verdict, 'the fixture passed in the app').toBe('PASS');
      const recorded = Object.entries(run!.deep_hashes).map(([step, h]) => `${step} ${h}`).sort();
      expect(recorded.length, 'the fixture records a full-state hash at each of its checkpoints').toBeGreaterThan(0);
      const app = bakeOf(bake!, 'the app\'s bake of the fixture');
      expect(firstDiff(cps(app, 'fixture').sort(), recorded), 'the app\'s bake gives the fixture\'s full-state hashes').toBeNull();
      expect(plan!['ok'], `web_plan gave a request: ${JSON.stringify(plan).slice(0, 400)}`).toBe(true);
      const chrome = await inChrome(str(runner!['source'], 'web_runner.source'), [plan!['request']!]);
      expect(chrome.userAgent, 'the page ran in headless Chrome').toMatch(/HeadlessChrome|Chrome/);
      const web = bakeOf(obj(chrome.replies[0], 'Chrome\'s bake'), 'Chrome\'s bake', true);
      expect(firstDiff(cps(web, 'fixture').sort(), recorded), 'headless Chrome\'s engine gives the same full-state hashes').toBeNull();
    }
  }, TIMEOUT);
});
