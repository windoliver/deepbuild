// AC5 #3219.3e5e1a25: "With no hub, a kit takes the file and its reply says so. A kit that holds no lease of either kind
// after its wait answers its GPU cases BLOCKED, as #2133 sets"
//
// Two legs, each in a temp HOME where no hub has ever run, each `deep-show run` of one kit call (`test.kit.gpu` on the
// GPU backend) started by this process. Leg one: nothing holds the GPU; the lease file `~/.cache/deepbuild-gpu/lease`
// is watched for the whole run and must hold the kit's PID while it runs, the kit must draw, and its reply's `lease`
// must say the lease was the file's: `{"gpu": true, "from": "file"}` (README: the reply's `lease.from`, chosen). Leg
// two: the file holds the PID of a live process this test started (a `sleep`), for longer than the kit's wait (600 tries
// 500 ms apart at the base, so about 5 minutes); with no hub there is no table, so after its wait the kit holds no lease
// of either kind, and as #2133 sets it answers every GPU case BLOCKED and reports `"lease": {"gpu": false}`, drawing
// nothing. Both legs run and their failures are listed together. At the base the reply has no `from`, and after its
// wait the kit draws anyway and says `"gpu": true` (#2133's defect).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, it } from 'vitest';
import { AC, alive, deepShow, ended, kitOf, kitScenario, LeaseFileWatch, loadNow, none, show, showDirect, World } from './helpers.ts';

describe(`${AC[5]} with no hub a kit takes the file and says so; one that holds no lease after its wait answers its GPU cases BLOCKED`, () => {
  it(`${AC[5]} with no hub, a kit holds the lease file and its reply's lease says the file; a kit whose wait for the file runs out holds no lease and answers its GPU cases BLOCKED`, async () => {
    const bin = await deepShow();
    const f: string[] = [];

    // Leg one: the file is the lease.
    const w = new World();
    const watch = new LeaseFileWatch(w.leaseFile);
    const run = showDirect(bin, kitScenario(w.folder('evidence')), 'the kit with no hub', w.env());
    const pid = String(await run.pid);
    const end = await ended(run, 900_000);
    watch.stop();
    const kit = kitOf(end);
    console.log(`AC5 the kit with no hub (${loadNow()}): ran ${end.t0}..${end.t1} as PID ${pid}; reply lease ${typeof kit === 'string' ? kit.slice(0, 300) : JSON.stringify(kit.lease)}; GPU cases ${typeof kit === 'string' ? '-' : kit.gpu.map((c) => `${c.case} ${c.verdict}`).join(', ')}; the lease file seen ${watch.seen.length} times holding PIDs ${watch.pids().join(', ') || 'none'}`);
    if (typeof kit === 'string') f.push(kit);
    else {
      if (!kit.drew) f.push(`with no hub, the kit drew nothing on the GPU: its GPU cases are ${kit.gpu.map((c) => `${c.case} ${c.verdict}`).join(', ') || 'none'}`);
      if (kit.lease.gpu !== true || kit.lease.from !== 'file') f.push(`with no hub, the kit's reply must say its lease was the file's, {"gpu": true, "from": "file"}; it says ${show(kit.lease)}`);
    }
    if (!watch.pids().includes(pid)) f.push(`with no hub, the kit (PID ${pid}) never held the lease file ~/.cache/deepbuild-gpu/lease: it was seen ${watch.seen.length} times, holding ${watch.pids().join(', ') || 'nothing'}`);

    // Leg two: a live process holds the file for longer than the kit's wait.
    const w2 = new World();
    const sleeper = spawn('/bin/sleep', ['3600'], { stdio: 'ignore', detached: true });
    try {
      mkdirSync(dirname(w2.leaseFile), { recursive: true });
      writeFileSync(w2.leaseFile, String(sleeper.pid));
      const waited = showDirect(bin, kitScenario(w2.folder('evidence')), 'the kit whose wait runs out', w2.env());
      const e2 = await ended(waited, 1_800_000);
      const k2 = kitOf(e2);
      console.log(`AC5 the kit whose wait runs out (${loadNow()}): ran ${e2.t0}..${e2.t1} (${((e2.t1 - e2.t0) / 1000).toFixed(1)} s) while PID ${sleeper.pid} (alive: ${alive(sleeper.pid!)}) held the file; reply lease ${typeof k2 === 'string' ? k2.slice(0, 300) : JSON.stringify(k2.lease)}; GPU cases ${typeof k2 === 'string' ? '-' : k2.gpu.map((c) => `${c.case} ${c.verdict}`).join(', ')}`);
      if (typeof k2 === 'string') f.push(k2);
      else {
        if (!k2.gpu.length) f.push('the kit whose wait ran out lists no GPU case');
        if (!k2.blocked) f.push(`a kit that holds no lease after its wait (the file held by live PID ${sleeper.pid}, no hub) must answer its GPU cases BLOCKED; they are ${k2.gpu.map((c) => `${c.case} ${c.verdict}`).join(', ')}`);
        if (k2.lease.gpu !== false) f.push(`a kit that holds no lease after its wait must report "lease": {"gpu": false}; it reports ${show(k2.lease)}`);
      }
    } finally {
      try { process.kill(sleeper.pid!, 'SIGKILL'); } catch { /* gone */ }
    }
    none(f, 'a kit with no hub');
  }, 3_600_000);
});
