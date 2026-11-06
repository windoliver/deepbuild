// #580 AC3: on the compose sample, where `web` is built from the repo and `db` runs postgres:16 with ./db/init
// bind-mounted, a claim that changes src/cart.ts builds `web` again, restarts `db` with that mount in the new run's
// checkout and its volume, templates included, kept, and the run's record names a build context digest for `web` equal
// to the checkout's files. A planted environment that reuses the `web` image built from the previous snapshot makes the
// run uncounted (#29), naming the image, and one that leaves `db` mounted from the previous run's checkout makes it
// uncounted, naming the mount. The journey waits for /release, written into `web` once the test has read Docker.
import { afterEach, describe, expect, it } from 'vitest';
import { Bench, containers, databases, docker, failureOf, hashed, inspect, nameOf, stepOf, treeDigest, type Line, type Pending, type Served } from './helpers.ts';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 300_000);

const MOUNT = '/docker-entrypoint-initdb.d';
interface Look { p: Pending; served: Served; finished: Line; web: Line; db: Line; dbId: string; template: boolean }
/** One claim, Docker read while its run lasts, then the journey let go. */
async function look(b: Bench, p: Pending, template: () => string | undefined): Promise<Look> {
  const served = await b.served(p);
  const webId = containers(served.project, 'web')[0];
  const dbId = containers(served.project, 'db')[0];
  expect(webId, `the stack's web container (project ${served.project})`).toBeDefined();
  expect(dbId, `the stack's db container (project ${served.project})`).toBeDefined();
  const name = template();
  const seen = { web: inspect(webId!), db: inspect(dbId!), dbId: dbId!, template: name !== undefined && databases(dbId!).includes(name) };
  docker(['exec', webId!, 'sh', '-c', 'echo ok > /www/release']);
  return { p, served, finished: await b.finished(p), ...seen };
}
const mountOf = (db: Line): Line | undefined => (db.Mounts as Line[]).find((m) => m.Destination === MOUNT);
const volumeOf = (db: Line): string | undefined => (db.Mounts as Line[]).find((m) => m.Type === 'volume')?.Name as string | undefined;

async function scenario(plant?: string): Promise<{ b: Bench; first: Look; second: Look; digest: string }> {
  const b = bench = await Bench.open({ variant: 'web', ...(plant ? { plant } : {}) });
  const s = await b.session();
  const template = () => { const seed = b.stepLog().find((l) => l.step === 'seed'); return seed?.database ? nameOf(seed.database) : undefined; };
  const first = await look(b, await b.claim(s), template);
  const pending = await b.claim(s);
  const digest = treeDigest(hashed(s.cwd, 'Dockerfile', 'src'));
  return { b, first, second: await look(b, pending, template), digest };
}
function criterion({ first, second, digest }: Awaited<ReturnType<typeof scenario>>): void {
  expect(first.finished.outcome, `the first run passed (${JSON.stringify(first.finished.findings).slice(0, 500)})`).toBe('passed');
  const uncounted = JSON.stringify(second.finished.findings);
  expect(second.finished.outcome, `the second run counts: ${second.finished.outcome} ${uncounted.slice(0, 700)}`).toBe('passed');
  const image = second.served.images.find((i) => i.service === 'web');
  expect(image?.built, `web was built again (${JSON.stringify(second.served.images)})`).toBe(true);
  expect(image!.context_digest, 'the record\'s build context digest equals the checkout\'s files').toBe(digest);
  expect(second.web.Image, 'a new image, built from the claim\'s snapshot').not.toBe(first.web.Image);
  const mount = mountOf(second.db)?.Source as string | undefined;
  expect(mount?.startsWith(`${second.served.checkout}/`), `db mounts ./db/init from the new run's checkout (${mount}; checkout ${second.served.checkout})`).toBe(true);
  expect(second.served.mounts.find((m) => m.target === MOUNT)?.source, 'the record names that mount').toBe(mount);
  expect(second.db.State.StartedAt, 'db was restarted for the run').not.toBe(first.db.State.StartedAt);
  expect(volumeOf(second.db), 'db\'s volume is kept').toBe(volumeOf(first.db));
  expect(second.template, 'with its templates in it').toBe(true);
  expect(stepOf(second.served, 'seed').status, 'the seed\'s template stands').toBe('reused');
}

describe('AC3 #580 an image built from app code is built again for each snapshot, and a bind-mounting service follows the run\'s checkout', () => {
  it('AC3 a claim changing src/cart.ts builds web again with the checkout\'s digest in its record, and restarts db with its mount in the run\'s checkout and its volume and templates kept', async () => {
    criterion(await scenario());
  }, 1_500_000);

  it('AC3 (wrong program) reusing the web image built from the previous snapshot (DEEP_HUB_PLANT=env-reuses-web-image) makes the run uncounted, naming the image', async () => {
    let seen: Awaited<ReturnType<typeof scenario>> | undefined;
    const failure = await failureOf(async () => { seen = await scenario('env-reuses-web-image'); criterion(seen); });
    expect(failure, 'the planted environment passed').not.toBeNull();
    expect(seen!.second.finished.outcome, 'the run is uncounted').toBe('uncounted');
    const findings = JSON.stringify(seen!.second.finished.findings);
    expect(findings, 'naming the image').toContain(String(seen!.second.web.Config.Image));
  }, 1_500_000);

  it('AC3 (wrong program) leaving db mounted from the previous run\'s checkout (DEEP_HUB_PLANT=env-keeps-db-mount) makes the run uncounted, naming the mount', async () => {
    let seen: Awaited<ReturnType<typeof scenario>> | undefined;
    const failure = await failureOf(async () => { seen = await scenario('env-keeps-db-mount'); criterion(seen); });
    expect(failure, 'the planted environment passed').not.toBeNull();
    expect(seen!.second.finished.outcome, 'the run is uncounted').toBe('uncounted');
    const findings = JSON.stringify(seen!.second.finished.findings);
    expect(findings, 'naming the mount').toContain(`${seen!.first.served.checkout}/db/init`);
  }, 1_500_000);
});
