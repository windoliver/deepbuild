// AC2 #1942.dd9b1b61: a model download survives the agent's session ending, and the claim waits for it.
//
// An agent's session (fixtures/agent.mjs through the real deep-hook and its own deep mcp) in a folder whose
// .deepbuild/done.yaml names the check model-download with `host: dh-fedora`: claims (deep_claim), then runs the check
// (deep_run). The download stands in for a model's: 40 MiB copied from source.bin in 1 MiB pieces, about one a second,
// "downloaded <i> of 40 MiB" after each, then "model.bin complete 41943040 bytes". Then the session ends (SessionEnd,
// and the agent's process and its deep mcp exit). Read (README): the run starts on dh-fedora as a user service whose
// name holds its run token; 15 s after the session ended that unit is still active and the download has grown, while
// the record holds no end for the run and no verdict on the claim; the download completes on the host (model.bin's
// SHA-256 is source.bin's), and the hub then records the run passed with the download's output, whole, as its stdout
// evidence, and any verdict on the claim only after that.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { AC, awaitEvent, COMMIT, events, mustBeOnHost, openWorld, proof, redact, runFinished, Session, sha256, sleep, type Line } from './helpers.ts';

const PIECES = 40;
const DOWNLOAD = `#!/bin/sh
# A model download, as a remote run on a host: ${PIECES} MiB copied from source.bin in 1 MiB pieces, about one a second.
printf '%s %s\\n' "\${DEEP_RUN_TOKEN:-none}" "$(tail -n 1 /proc/self/cgroup)" >> download.starts
: > model.part
i=0
while [ "$i" -lt ${PIECES} ]; do
  dd if=source.bin of=model.part bs=1048576 skip="$i" seek="$i" count=1 conv=notrunc status=none || exit 3
  i=$((i + 1))
  echo "downloaded $i of ${PIECES} MiB"
  sleep 1
done
mv model.part model.bin
echo "model.bin complete $(wc -c < model.bin | tr -d ' ') bytes"
`;
const OUTPUT = `${Array.from({ length: PIECES }, (_, i) => `downloaded ${i + 1} of ${PIECES} MiB`).join('\n')}\nmodel.bin complete ${PIECES * 1048576} bytes\n`;

describe(AC[2], () => {
  test('a download an agent starts on a host runs on as a user service named by its token after the session ends; its claim gets no verdict, nor the run an end, until the download ends there', async () => {
    const w = await openWorld('deep-fedora', { noToolWait: true, approve: true });
    const h = w.host;
    const source = (await h.must(`cd "${h.folder}" && head -c ${PIECES * 1048576} /dev/urandom > source.bin && sha256sum source.bin | cut -d' ' -f1`)).trim();
    await h.must(`cat > "${h.folder}/download.sh"`, { input: DOWNLOAD });
    const repo = join(w.tmp, 'repo');
    mkdirSync(join(repo, '.deepbuild'), { recursive: true });
    writeFileSync(join(repo, '.deepbuild', 'done.yaml'), `checks:\n  model-download:\n    run: cd "$HOME/${h.name}" && exec /bin/sh ./download.sh\n    host: ${w.alias}\n`);

    const s = new Session(w, repo);
    await s.start();
    const claimed = await s.tool('deep_claim', { task_ref: `session:${s.letters}#model`, attempt: 1, commit: COMMIT, scope: 'session', predictions: null });
    const claim = claimed.value.claim;
    expect(typeof claim === 'string' && !claimed.isError, `deep_claim makes the session's claim: ${claimed.text.slice(0, 600)}`).toBe(true);
    // The agent runs the check; a reply that names no run yet (an ask of yours under way) is asked again, as an agent would.
    let ran: Line = {};
    for (let i = 0; i < 4 && typeof ran.run !== 'string'; i++) {
      if (i) await sleep(5000);
      const r = await s.tool('deep_run', { check: 'model-download', claim });
      ran = r.isError ? { error: r.text } : r.value;
    }
    const run = ran.run;
    expect(typeof run, `deep_run of model-download answers its run: ${redact(JSON.stringify(ran).slice(0, 600), h.ssh)}`).toBe('string');
    await mustBeOnHost(w, String(run));

    let started: { token: string; cgroup: string }[] = [];
    for (const deadline = Date.now() + 90_000; !started.length && Date.now() < deadline; await sleep(1000)) started = await h.starts('download');
    expect(started.length, `the download started on ${w.alias} (download.starts)`).toBe(1);
    const token = started[0]!.token;
    expect(token, `the run on ${w.alias} has its run token in DEEP_RUN_TOKEN`).not.toBe('none');
    expect(started[0]!.cgroup, `the download runs as a user service whose name holds its run token (its cgroup: ${redact(started[0]!.cgroup, h.ssh)})`).toMatch(new RegExp(`user@\\d+\\.service/.*${token.replace(/[^A-Za-z0-9]/g, '.')}`));

    await s.end();
    const ended = await awaitEvent(w, (all) => all.find((e) => e.kind === 'session.end' && (e.session === s.id || e.subject === `session:${s.letters}`)), 60_000);
    expect(ended, 'the record holds the session\'s end').toBeDefined();
    const partSize = async (): Promise<number> => Number((await h.sh(`wc -c < "${h.folder}/model.part" 2>/dev/null || echo 0`)).stdout.trim() || 0);
    const atEnd = await partSize();
    await sleep(15_000);
    const units = await h.unitsHolding(token);
    const later = await partSize();
    const midway = await events(w);
    const verdictsBefore = midway.filter((e) => e.kind === 'verdict.made' && (e.subject === claim || e.data.claim === claim));
    proof(w, 'ac2-midway.json', { run, claim, host: w.alias, token: `${token.slice(0, 8)}…`, units, part_bytes: { at_session_end: atEnd, after_15_s: later }, finished: runFinished(midway, String(run))?.data ?? null, verdicts: verdictsBefore.map((e) => e.data) });
    expect(units.filter((u) => u.active === 'active').map((u) => u.unit.includes(token)), `15 s after the session ended, the user unit holding the run's token is still active on ${w.alias}: ${JSON.stringify(units)}`).toEqual([true]);
    expect(later, `the download kept going after the session ended (model.part ${atEnd} bytes then, ${later} 15 s later)`).toBeGreaterThan(atEnd);
    expect(runFinished(midway, String(run))?.data ?? null, `while the download still runs on ${w.alias}, the hub records no end for ${String(run)}`).toBeNull();
    expect(verdictsBefore.map((e) => e.data.outcome), `while its run still runs on ${w.alias}, the claim ${claim} has no verdict: it waits for its run`).toEqual([]);

    let complete = '';
    for (const deadline = Date.now() + 120_000; !complete && Date.now() < deadline; await sleep(2000)) complete = (await h.sh(`sha256sum "${h.folder}/model.bin" 2>/dev/null | cut -d' ' -f1`)).stdout.trim();
    expect(complete, `the download completed on ${w.alias}: model.bin is source.bin`).toBe(source);
    const end = await awaitEvent(w, (all) => runFinished(all, String(run)), 90_000);
    const after = await events(w);
    proof(w, 'ac2-end.json', { run, finished: end?.data ?? null, expected_stdout_sha256: sha256(OUTPUT), expected_stdout: OUTPUT, answered: w.answered });
    expect(end?.data.outcome, `once the download ended on ${w.alias}, the hub records ${String(run)} passed`).toBe('passed');
    expect(end!.data.evidence, `${String(run)}'s stdout evidence is the download's output, whole (sha256 ${sha256(OUTPUT).slice(0, 12)})`).toContain(sha256(OUTPUT));
    const early = after.filter((e) => e.kind === 'verdict.made' && (e.subject === claim || e.data.claim === claim) && Number(e.log_pos) < Number(end!.log_pos));
    expect(early.map((e) => e.data.outcome), `no verdict on ${claim} comes before its run's end`).toEqual([]);
  }, 600_000);
});
