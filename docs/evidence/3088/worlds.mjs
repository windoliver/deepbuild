// #3088 e2e: build each named case's world with the kit's own makeWorld, as `gate run` does, and list the
// platform packages (lockfile os/cpu) its node_modules got though the manifest doesn't list them.
// Usage: node --experimental-transform-types worlds.mjs <repo>
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.argv[2];
const { makeWorld, Owned } = await import(pathToFileURL(join(repo, 'packages/conformance/src/gate-play.ts')).href);
const manifest = JSON.parse(readFileSync(join(repo, 'packages/conformance/fixtures/gate/manifest.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8')).packages;
const marked = Object.keys(lock).filter((k) => k && (lock[k].os || lock[k].cpu));
for (const id of ['reporting-vitest-setup', 'reporting-rewrite-on-import']) {
  const c = manifest.cases.find((x) => x.id === id);
  const listed = c.setup.installs.filter((p) => marked.includes(p));
  const owned = new Owned();
  try {
    const w = makeWorld(owned, join(repo, 'packages/conformance/fixtures/gate', c.dir, 'base'), { installs: c.setup.installs });
    const got = marked.filter((p) => existsSync(join(w.repo, p)));
    console.log(`${id}: manifest lists ${c.setup.installs.length} installs, ${listed.length} of them os/cpu-marked`);
    for (const p of got) console.log(`  world has ${p}  (lockfile os=${JSON.stringify(lock[p].os ?? null)} cpu=${JSON.stringify(lock[p].cpu ?? null)})`);
  } finally {
    await owned.stop();
  }
}
