// #331 AC11: two worktrees of a repo whose environment is `compose: docker-compose.yml`, with
// `ports: ["${web}:3000"]`, come up as two compose projects named from their run tokens on different leased ports;
// `deep env down` in one removes only its project's containers, its lease ends once no container with its project
// label remains, and the other stack still answers its health route. The wrong program, a runner that starts
// compose under the repo's default project name, makes the second up replace the first and fails, naming the
// project. Real Docker only: with the daemon unreachable, or no local image (nothing is pulled), each test fails
// BLOCKED naming why. The test removes only the containers of the projects its own stacks reported.
import { basename } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, Client, docker, dockerReady, envDown, health, makeRepo, portEvents, startHub, stopHub, sub, tempDir, upReady, waitFor, type Line } from './helpers.ts';

const projects = new Set<string>();
afterEach(async () => {
  for (const p of projects) {
    const ids = docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${p}`]).stdout.split('\n').filter(Boolean);
    if (ids.length) docker(['rm', '-f', ...ids]);
  }
  projects.clear();
  await cleanup();
}, 120_000);

/** The repo's own compose file. Its top-level name is the repo's default project name, the same in every worktree. */
const DEFAULT_PROJECT = 'shop';
const COMPOSE = (image: string) => [
  `name: ${DEFAULT_PROJECT}`,
  'services:',
  '  web:',
  `    image: ${image}`,
  '    command: ["httpd", "-f", "-p", "3000", "-h", "/www"]',
  '    volumes: ["./www:/www:ro"]',
  '    ports: ["${web}:3000"]',
  '',
].join('\n');
const containers = (project: string): string[] => docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]).stdout.split('\n').filter(Boolean);

type Plant = 'compose-default-project';
interface Seen { a: string; b: string; upA: Line; upB: Line; aAfterB: number | null; events: Line[]; afterDown: { a: string[]; b: string[]; bHealth: number | null; released: Line[]; aReleasedWithContainers: boolean } }

async function scenario(plant?: Plant): Promise<Seen> {
  const image = dockerReady();
  const t = makeRepo({ compose: 'docker-compose.yml', ports: ['web'], ready: 'http://127.0.0.1:${web}/health', within: 60 }, { 'docker-compose.yml': COMPOSE(image), 'www/health': '{"ok":true}\n' });
  const a = t.worktree('wt-a');
  const b = t.worktree('wt-b');
  for (const name of [DEFAULT_PROJECT, basename(a), basename(b)]) projects.add(name);
  const hub = await startHub(sub(tempDir(), 'root'), plant ? { DEEP_HUB_PLANT: plant } : {});
  const client = await Client.open(hub);
  try {
    const upA = await upReady(hub, a, 300_000);
    if (typeof upA.project === 'string') projects.add(upA.project);
    const upB = await upReady(hub, b, 300_000);
    if (typeof upB.project === 'string') projects.add(upB.project);
    const aAfterB = (await health(upA.ports.web)).status;
    const down = await envDown(hub, a, 120_000);
    expect(down.ran.code, `deep env down in wt-a exits 0 (${down.ran.stdout} ${down.ran.stderr})`).toBe(0);
    let aReleasedWithContainers = false;
    const released = await waitFor(async () => {
      const r = portEvents(await client.events('lease.released'), 'lease.released', upA.ports.web);
      if (r.length && typeof upA.project === 'string' && containers(upA.project).length) aReleasedWithContainers = true;
      return r.length ? r : undefined;
    }, 60_000, `the lease on ${upA.ports.web} to end`).catch(() => [] as Line[]);
    return {
      a, b, upA, upB, aAfterB, events: await client.events(),
      afterDown: { a: typeof upA.project === 'string' ? containers(upA.project) : [], b: typeof upB.project === 'string' ? containers(upB.project) : [], bHealth: (await health(upB.ports.web)).status, released, aReleasedWithContainers },
    };
  } finally {
    client.close();
    await stopHub(hub);
  }
}

function criterion(s: Seen): void {
  const pa = s.upA.project as string;
  const pb = s.upB.project as string;
  expect(typeof pa === 'string' && typeof pb === 'string', `each up names its compose project (${pa}, ${pb})`).toBe(true);
  expect(pa, `the two worktrees share the compose project ${pa}`).not.toBe(pb);
  for (const [p, wt] of [[pa, s.a], [pb, s.b]] as const) {
    expect(p, `the compose project ${p} is compose's default for the folder, not one named from the run token`).not.toBe(basename(wt).toLowerCase());
    expect(p, `the compose project ${p} is the repo's default project name (compose's name:)`).not.toBe(DEFAULT_PROJECT);
  }
  expect(s.upA.ports.web, `both stacks on port ${s.upA.ports.web}`).not.toBe(s.upB.ports.web);
  expect(s.aAfterB, `the second up replaced the first stack (project ${pa}): wt-a's health route stopped answering on ${s.upA.ports.web}`).toBe(200);
  expect(s.afterDown.a, `containers of ${pa} remain after deep env down in wt-a`).toEqual([]);
  expect(s.afterDown.b.length, `deep env down in wt-a removed the other project ${pb}'s containers`).toBeGreaterThan(0);
  expect(s.afterDown.bHealth, `the other stack (project ${pb}) still answers its health route on ${s.upB.ports.web}`).toBe(200);
  expect(s.afterDown.released.length, `the lease on ${s.upA.ports.web} (project ${pa}) ended`).toBeGreaterThan(0);
  expect(s.afterDown.aReleasedWithContainers, `the lease on ${s.upA.ports.web} ended while a container labelled ${pa} remained`).toBe(false);
  expect(portEvents(s.events, 'lease.released', s.upB.ports.web).map((e) => e.data), `the other stack's lease on ${s.upB.ports.web} ended`).toEqual([]);
}

describe('AC11 #331.14c365a0 two worktrees\' compose stacks run as their own projects on different leased ports; down removes only its own', () => {
  it('AC11 two compose projects named from their run tokens on different leased ports; down in one removes only its containers, its lease ends after them, the other still answers', async () => {
    criterion(await scenario());
  }, 600_000);

  it('AC11 (wrong program) a runner that starts compose under the repo\'s default project name makes the second up replace the first, and fails this test naming the project', async () => {
    const seen = await scenario('compose-default-project');
    expect(() => criterion(seen), 'the plant passed the criterion').toThrow(/project/);
  }, 600_000);
});
