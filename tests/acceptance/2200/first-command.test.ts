// #2200, criterion 3: the first command still sets up. `deep status`, whose arguments read, in the same home as the
// usage errors: setup runs as on the merge base.
//
// "As on the merge base" is read by what the base leaves behind (README: Criterion 3): the files setup writes, the
// DeepBuild hooks in Claude Code's user settings, the launcher's call with the login-service file, and the exit code.
// The files and the calls are compared with what `deep setup` itself leaves in a second fresh home, so the test names
// no platform's list: the design's "the first `deep` command does the same without a click". This test passes on the
// base. Its wrong program is the twin `never-sets-up` (twins.json), on which it fails at its first assertion.

import { afterAll, describe, expect, it } from 'vitest';
import { deepEntries, readSettings } from '../19/doctor/helpers.ts';
import { cleanup, freshHome, outcome, shown } from './helpers.ts';

afterAll(cleanup, 60_000);

/** The files the issue's "What happens today" names among those the first command writes, from the home. */
const NAMED = ['.claude/settings.json', '.claude/skills/deepbuild/SKILL.md', '.claude.json', '.deepbuild/config.json', '.deepbuild/rules.json'];
describe('#2200.b9e90749 the first command still sets up', () => {
  it('#2200.b9e90749 deep status in a home with no .deepbuild sets up as on the merge base: the files deep setup writes, its hooks in the settings, the launcher called with the login-service file, exit 3', async () => {
    const h = freshHome();
    const status = await outcome(h, ['status']);
    const wrote = status.files;
    expect(wrote.filter((path) => path.startsWith('h/')).map((path) => path.slice(2)), `deep status, the first command in this home, must set DeepBuild up: ${shown(status.ran)}`).toEqual(expect.arrayContaining(NAMED));
    expect(deepEntries(readSettings(h)).length, 'setup adds DeepBuild\'s hooks to Claude Code\'s user settings').toBeGreaterThan(0);
    // The launcher is called once, with the login-service file setup wrote under the home.
    expect(status.called.map((call) => call.split(' ')[0]), `the stand-ins' calls: ${JSON.stringify(status.called)}`).toContain('launcher');
    const service = status.called.find((call) => call.startsWith('launcher '))!.split(' ')[1]!;
    expect(service.startsWith('<tmp>/h/') && wrote.includes(service.slice('<tmp>/'.length)), `the launcher is called with the login-service file setup wrote under the home: ${JSON.stringify(status.called)}, wrote ${JSON.stringify(wrote)}`).toBe(true);
    // The launcher refused, so no hub answers: status has nothing to read and says so with exit 3, as on the base.
    expect(status.exit, `deep status with setup done and no hub answering exits 3, as on the merge base: ${shown(status.ran)}`).toBe(3);

    // The same as `deep setup` leaves in a home of its own.
    const setup = await outcome(freshHome(), ['setup']);
    expect({ written: wrote, called: status.called }, `the first deep status writes the files, and makes the stand-in calls, that deep setup does: ${shown(setup.ran)}`).toEqual({ written: setup.files, called: setup.called });
  }, 600_000);
});
