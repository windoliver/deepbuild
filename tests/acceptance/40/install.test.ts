// #40 AC6: real `pi install` of the package at the version its facts pin, from a local registry that stands in for
// npm (a boundary the repo doesn't own), into a scratch home. `npm pack` makes the tarball from packages/pi as it would
// be published, so a package that leans on the workspace fails here.
import { createServer, type Server } from 'node:http';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NODE, PACKAGE, REPO, cleanup, childEnv, needPackage, piCli, readFacts, run, tempDir, Pi, type Line } from './helpers.ts';

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((done) => s.close(done));
  await cleanup();
}, 60_000);

/** A registry holding `name` at the versions given: `latest` is the newest, so only a pin keeps the old one. */
async function registry(name: string, versions: Record<string, Buffer>): Promise<string> {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? '');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    if (url === `/${name}`) {
      const entries = Object.entries(versions);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        name, 'dist-tags': { latest: entries.at(-1)![0] },
        versions: Object.fromEntries(entries.map(([v, tgz]) => [v, { name, version: v, dist: { tarball: `${base}/t/${v}.tgz`, shasum: createHash('sha1').update(tgz).digest('hex') } }])),
      }));
      return;
    }
    const tarball = /^\/t\/(.+)\.tgz$/.exec(url);
    if (tarball && versions[tarball[1]!]) { res.end(versions[tarball[1]!]); return; }
    res.statusCode = 404;
    res.end('{}');
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
}

async function packed(): Promise<{ name: string; version: string; tgz: Buffer }> {
  needPackage();
  const out = tempDir();
  const r = await run('npm', ['pack', '--pack-destination', out, '--ignore-scripts'], { cwd: PACKAGE, timeoutMs: 120_000 });
  if (r.code !== 0) throw Error(`npm pack of packages/pi exited ${r.code}: ${r.stderr}`);
  const manifest = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')) as Line;
  return { name: String(manifest.name), version: String(manifest.version), tgz: readFileSync(join(out, readdirSync(out).find((f) => f.endsWith('.tgz'))!)) };
}

describe('AC6 #40.c666bc59 The package installs with `pi install` and is pinned to a version', () => {
  it('AC6 the package is a pi package at an exact version, and pi\'s facts pin it there', () => {
    needPackage();
    const manifest = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')) as Line;
    expect(manifest.name).toBe('@deepbuild/pi');
    expect(manifest.version, 'an exact version').toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.private, 'a package pi can install isn\'t private').not.toBe(true);
    expect(manifest.keywords).toContain('pi-package');
    expect(Array.isArray(manifest.pi?.extensions) && manifest.pi.extensions.length > 0, 'its pi manifest names its extension').toBe(true);
    const all = { ...(manifest.dependencies as Line | undefined) };
    for (const host of ['@earendil-works/pi-ai', '@earendil-works/pi-agent-core', '@earendil-works/pi-coding-agent', '@earendil-works/pi-tui', 'typebox']) {
      expect(Object.keys(all), `${host} is supplied by pi, never a dependency (pi's packages doc)`).not.toContain(host);
    }
    expect(Object.keys(all).filter((d) => d.startsWith('@deepbuild/')), 'nothing unpublished: the package carries what it needs').toEqual([]);
    expect(readFacts().install?.source, 'the pin').toBe(`npm:${String(manifest.name)}@${String(manifest.version)}`);
  });

  it('AC6 `pi install <the facts\' source>` installs it pinned, it loads in a real session, and `pi update` keeps the pin', async () => {
    const cli = piCli();
    const { name, version, tgz } = await packed();
    const newer = `${version.split('.').slice(0, 2).join('.')}.${Number(version.split('.')[2]) + 1}`;
    const url = await registry(name, { [version]: tgz, [newer]: tgz });
    const tmp = tempDir();
    const home = join(tmp, 'h');
    mkdirSync(home);
    const cwd = join(tmp, 'w');
    mkdirSync(cwd);
    const env = childEnv(home, { npm_config_registry: url, npm_config_cache: join(tmp, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false' });
    const source = String(readFacts().install?.source);
    const installed = await run(NODE, [cli, 'install', source], { cwd, env, timeoutMs: 180_000 });
    expect(installed.code, `pi install ${source}: ${installed.stdout}${installed.stderr}`).toBe(0);
    const settings = JSON.parse(readFileSync(join(home, '.pi/agent/settings.json'), 'utf8')) as { packages: (string | { source: string })[] };
    expect(settings.packages.map((p) => (typeof p === 'string' ? p : p.source)), 'the settings hold the exact version').toEqual([`npm:${name}@${version}`]);
    const listed = await run(NODE, [cli, 'list'], { cwd, env, timeoutMs: 60_000 });
    expect(listed.stdout, 'pi list names it at its version').toContain(`npm:${name}@${version}`);

    // Loaded from settings alone, under no -e, the native tools reach the model.
    const pi = await Pi.start(home, cwd, { steps: [{ text: 'hello' }], withPackage: false });
    await pi.call({ type: 'prompt', message: 'hi' });
    await pi.until('agent_settled', 1, 60_000);
    const offered = (pi.requests()[0]!.tools as Line[]).map((t) => String(t.name));
    const described = JSON.parse(readFileSync(join(REPO, 'packages/hub/tools.json'), 'utf8')) as Record<string, string>;
    expect(offered.filter((t) => t.startsWith('deep_')).sort(), `the installed package registers its tools; extension errors: ${JSON.stringify(pi.events.filter((e) => e.type === 'extension_error')).slice(0, 600)}`).toEqual(Object.keys(described).sort());
    await pi.stop();

    const updated = await run(NODE, [cli, 'update', '--extensions'], { cwd, env, timeoutMs: 180_000 });
    expect(updated.code, `pi update: ${updated.stdout}${updated.stderr}`).toBe(0);
    const after = JSON.parse(readFileSync(join(home, '.pi/agent/settings.json'), 'utf8')) as { packages: (string | { source: string })[] };
    expect(after.packages.map((p) => (typeof p === 'string' ? p : p.source)), 'the pin holds with a newer version on the registry').toEqual([`npm:${name}@${version}`]);
    const found = await run('/usr/bin/find', [join(home, '.pi/agent'), '-path', `*/${name}/package.json`], { timeoutMs: 20_000 });
    const manifests = found.stdout.split('\n').filter(Boolean).map((f) => (JSON.parse(readFileSync(f, 'utf8')) as Line).version);
    expect(manifests, `the installed copy is still ${version}, not ${newer}`).toEqual([version]);
  }, 500_000);

  it('AC6 (wrong program) a floating source moves with the registry, so the pin check tells them apart', async () => {
    const cli = piCli();
    const { name, version, tgz } = await packed();
    const newer = `${version.split('.').slice(0, 2).join('.')}.${Number(version.split('.')[2]) + 1}`;
    const url = await registry(name, { [version]: tgz, [newer]: tgz });
    const tmp = tempDir();
    const home = join(tmp, 'h');
    mkdirSync(home);
    const env = childEnv(home, { npm_config_registry: url, npm_config_cache: join(tmp, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false' });
    const r = await run(NODE, [cli, 'install', `npm:${name}`], { cwd: home, env, timeoutMs: 180_000 });
    expect(r.code).toBe(0);
    const settings = JSON.parse(readFileSync(join(home, '.pi/agent/settings.json'), 'utf8')) as { packages: (string | { source: string })[] };
    expect(settings.packages.map((p) => (typeof p === 'string' ? p : p.source)), 'what an unpinned install writes').not.toEqual([`npm:${name}@${version}`]);
    writeFileSync(join(tmp, 'ok'), '');
  }, 300_000);
});
