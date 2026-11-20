// #1812 AC6 (README): not decided or not checked exits 3. `deep update --check` with the registry unreachable (the CLI's
// DEEP_UPDATE_URL naming a port on 127.0.0.1 that nothing listens on) checked nothing. A cancelled OS confirmation (the
// hub's DEEP_HUB_TEST_CONFIRM stub, answering `cancelled`) decides nothing: `deep inbox answer` on the approval `deep
// start approve` raised, `deep race`, and `deep start` under that approval, which the cancelled answer left open.
import net from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, cleanup, deep, hubRun, needBuild, repo, shown, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1812.b70b92a8';

/** A port on 127.0.0.1 that nothing listens on: one the system just handed out, closed again. */
function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

describe(`${ID} not decided or not checked exits 3`, () => {
  it(`${ID} deep update --check with the registry unreachable exits 3`, async () => {
    needBuild();
    const r = await deep(world(), ['update', '--check'], { extra: { DEEP_UPDATE_URL: `http://127.0.0.1:${await closedPort()}/deepbuild/latest` }, timeoutMs: 60 * SECOND });
    expect(r.code, `deep update --check with the registry unreachable checked nothing, so it exits 3: ${shown(r)}`).toBe(3);
  }, 120 * SECOND);

  it(`${ID} a cancelled confirmation exits 3 from deep race, deep start and deep inbox answer alike`, async () => {
    needBuild();
    const w = world();
    const checkout = repo(w);
    await hubRun(w);
    const approve = await deep(w, ['start', 'approve', '--repo', checkout, '--issues', '1', '--agents', 'claude-code', '--at-once', '1', '--plan-share', '10', '--json'], { timeoutMs: 60 * SECOND });
    const ask = /\bask:[0-9A-Za-z]+/.exec(approve.stdout)?.[0];
    if (approve.code !== 0 || !ask) throw Error(`BLOCKED: deep start approve raised no approval to answer: ${shown(approve)}`);
    const runs: [string, string[]][] = [
      ['deep inbox answer', ['inbox', 'answer', ask, 'allow']],
      ['deep race', ['race', '1']],
      ['deep start', ['start', '--repo', checkout, '--issue', '1', '--agent', 'claude-code', '--prompt', 'go']],
    ];
    const failures: string[] = [];
    for (const [name, args] of runs) {
      const r = await deep(w, args, { timeoutMs: 60 * SECOND });
      if (r.code !== 3) failures.push(`${name} exits ${r.code}, not 3: ${shown(r)}`);
      if (name === 'deep inbox answer') {
        // The confirmation was cancelled, so the approval is still open: what deep start then runs under.
        const open = await deep(w, ['inbox', '--json'], { timeoutMs: 60 * SECOND });
        if (!open.stdout.includes(`"${ask}"`)) throw Error(`BLOCKED: ${ask} isn't open after its confirmation was cancelled: ${shown(open)}`);
      }
    }
    expect(failures, `${failures.length} of ${runs.length} commands don't exit 3 on a cancelled confirmation:\n${failures.join('\n')}`).toEqual([]);
  }, 600 * SECOND);
});
