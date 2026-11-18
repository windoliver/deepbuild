// AC2: a `main` whose `#!` line points to a macOS framework Python binary
// (`.../Frameworks/Python.framework/Versions/<v>/Resources/Python.app/Contents/MacOS/Python`) receives read access to
// `Versions/<v>` and starts in the sandbox.
//
// Real components: a framework Python installed on this Mac, the guide's JSON-RPC example as the package, the
// extension host through its public entry, the real supervisor and Seatbelt. The one thing the test adds is a
// record of what the host asks the supervisor to let the run read, taken as the request passes through.
import { describe, expect, it } from 'vitest';
import { frameworkPython, jsonRpcPackage, needsMac, openHost, openWorld, pathDirFor, tempDir, withEnv } from './helpers.ts';

const AC2 = '#2312.0c8eab61';

describe(`AC2 ${AC2} a main whose #! line points to a macOS framework Python binary receives read access to Versions/<v> and starts in the sandbox`, () => {
  it('AC2 a main on a framework Python\'s Python.app binary is let read Versions/<v>, registers in the platform sandbox and answers its check', async () => {
    needsMac();
    const python = frameworkPython();
    // The hub runs this interpreter by name: python3 on its PATH is this binary.
    await withEnv({ PATH: `${pathDirFor(python.binary)}:/usr/bin:/bin` }, async () => {
      const { dir, id, run } = await jsonRpcPackage(python.binary);
      const { h, starts } = await openHost(await openWorld());
      const p = await h.install({ from: dir, builtBy: null });
      const c = await h.check(p);
      expect(starts.length, 'conformance starts the package\'s main in the platform sandbox').toBeGreaterThan(0);
      for (const start of starts) {
        expect.soft(start.read, `the run of a main on ${python.binary} is let read its install, ${python.root}`).toContain(python.root);
      }
      expect(c, `the package passes conformance: ${JSON.stringify(c.reasons)}`).toMatchObject({ passed: true });
      const load = await h.load(p);
      expect(load, `the package loads, out of process in the sandbox: ${JSON.stringify(load)}`).toMatchObject({ status: 'loaded', place: 'sandbox' });
      for (const start of starts) expect(start.read, `every start of the main is let read ${python.root}`).toContain(python.root);
      expect(await h.checks(), 'the check kind the main registered is in use').toContainEqual({ kind: run.check, extension: id });
      for (const r of run.runs) {
        const result = await h.runCheck(run.check, r.spec as never, { checkout: tempDir('checkout'), deadline: 60_000 });
        expect(result, `${run.check} on ${JSON.stringify(r.spec)}, answered by the main in the sandbox`).toMatchObject(r.expect);
      }
    });
  }, 240_000);
});
