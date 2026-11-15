// #1606 AC6: a process running as you, outside the app, with every file under ~/.deepbuild in hand, can't make a
// signature the hub counts. The world holds the app's device: a key the app paired, kept where and as the merge base's
// app keeps it (~/.deepbuild/app/device.json), and then the real app started on that home with its stand-ins (README,
// Surfaces), which moves the key into the OS store at its start. Then this test process reads every file under the
// hub's root and signs an Allow on a fixture approval ask with every key pair it finds and with a key of its own, as
// every device the files name. On the merge base the app leaves its key in the file and the Allow counts; that run is
// in BASE-FAILURE.txt.
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AC, appEnv, appRuns, appWith, cleanup, hubWorld, launchApp, olderAppKey, setupFinished, steal, stolenFailures, within } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC[6]} A test process running as you, outside the app, reads every file under ~/.deepbuild and still can't make a signature the hub counts`, () => {
  it(`${AC[6]} with every file under ~/.deepbuild read, its signed Allow on a fixture approval ask is refused with credential, and the ask stays open`, async () => {
    const { binary, missing } = await appWith();
    const w = await hubWorld({ asks: [{ source: 'effect.push', question: 'Deploy the billing service to production?' }], files: setupFinished });
    const ask = w.asks[0]!;
    const older = await olderAppKey(w);
    const app = launchApp(w.home, binary, appEnv(w, 'cancelled'));
    await appRuns(w.home, app, `deepbuild://ask/${ask.handle.slice('ask:'.length)}`);
    // The move is the app's, at its start; a wrong program never makes it, so this waits for it no longer than 30 s.
    await within(30_000, () => !existsSync(older.file));
    const failures = await stolenFailures(w, ask, await steal(w, ask));
    expect(failures).toEqual([]);
    expect(missing, 'the app was built with its stand-ins (README, Surfaces)').toBeUndefined();
  }, 1_800_000);
});
