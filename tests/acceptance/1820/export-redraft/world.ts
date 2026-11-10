// World for the #1820 re-export tests: #1731's real hub in a temp home (its `deep mcp`, cli socket, test CA), the
// scope fixtures' local HTTPS pack server (a request log; "offline" is the server closed), and `deep export` run as a
// process with that hub's HOME. Nothing is mocked; nothing leaves 127.0.0.1. Reused read-only.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { asks, CLI, kinds, NODE, sleep, type Line, type Outcome } from '../../1731/helpers.ts';
import { CC0 } from '../pack.ts';
import { addAsset, installOrBlock, LICENSE_TEXT, scopedWorld, writePack, type Scoped } from '../scope/world.ts';

export { asks, kinds, sleep };
export type { Line, Outcome, Scoped };
export { addAsset, installOrBlock, LICENSE_TEXT, writePack };
export { CC0 };

export interface Ran { code: number | null; stdout: string; stderr: string; out: string; png: Buffer | undefined }
let n = 0;
/** `deep export --document <file> --still 0 --out <file.png>` as a child of the hub's home, the shipped CLI. */
export function exportStill(w: Scoped, document: Line): Promise<Ran> {
  const id = ++n;
  const doc = join(w.tmp, `doc-${id}.json`);
  const out = join(w.tmp, `still-${id}.png`);
  writeFileSync(doc, JSON.stringify(document));
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|NODE_OPTIONS|NODE_EXTRA_CA_CERTS)/.test(k)) env[k] = v;
    const child = spawn(NODE, [CLI, 'export', '--document', doc, '--still', '0', '--out', out], { cwd: w.work, env: { ...env, HOME: w.home, XDG_CONFIG_HOME: join(w.home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 240_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, out, png: existsSync(out) ? readFileSync(out) : undefined }); });
  });
}
export const said = (r: Ran): string => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-800))}, stderr ${JSON.stringify(r.stderr.slice(-800))}, png ${r.png ? `${r.png.length} bytes` : 'none'}`;

/** A document with one 8×8 picture item whose asset is a pack asset named by hash, in a document that names `pack@version`. */
export function pictureDoc(pack: string, sha: string): Line {
  return {
    format: 1, profile: 'film', title: 'One pack picture', description: 'A solid picture from a pack asset, filling the frame (#1820).',
    packs: [pack], size: [8, 8], transport: { frame_rate: [30, 1], span: '1s' },
    assets: { 'pic.png': { sha256: sha, license: 'CC0-1.0' } },
    layers: { main: { writer: 'agent:thread-alpha', title: 'Pack picture', order: 'a0' } },
    items: { pic: { id: 'pic', kind: 'image@1', layer: 'main', name: 'Pack picture', order: 'a1', params: { asset: sha, box: [0, 0, 8, 8], fit: 'fill', alt: 'A solid color' } } },
  };
}

/** A fetch of a pack asset on the job #1731 uses: asked once, your yes, then called until it is no longer held. */
export async function fetchAfterYes(w: Scoped, pack: string, path: string, answer: (ask: { handle: string; data: Line }) => Promise<unknown>): Promise<Outcome> {
  const args = { op: 'fetch', pack, asset: path };
  const before = (await asks(w)).length;
  let o = await kinds(w, args);
  if (o.value.status === 'held') {
    const raised = (await asks(w, 'authority')).slice(before);
    if (raised.length !== 1) throw Error(`the first fetch of ${pack} ${path} raised ${raised.length} authority asks, not one`);
    await answer(raised[0]!);
    for (const deadline = Date.now() + 120_000; ; await sleep(500)) {
      o = await kinds(w, args);
      if (o.value.status !== 'held' || Date.now() > deadline) break;
    }
  }
  return o;
}
export { scopedWorld };
