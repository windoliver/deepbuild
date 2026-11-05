// #309.1: the shipped relay answers relay@1 with the digest committed in the repo and passes the relay suite; and a
// planted relay that forwards one frame to another match's copies fails the suite, naming both match IDs.
//
// The shipped relay is `deep-relay`, started here on 127.0.0.1 with a throwaway certificate; the relay suite is
// `deep-relay-suite`, run against it (README: The surface under test). The suite's report carries every connection it
// opened, the match each joined and every frame each sent and received, and this file reads those frames itself in
// relay@1's little-endian layout: the suite's verdict is never the only evidence. At the base there is no relay crate,
// so neither binary builds, digests.json holds no relay@1 and scripts/lanes.mjs has no lane relay.
import { describe, expect, it } from 'vitest';
import { committed, lanes, readFrame, relaySuite, runAsync, lastJson, obj, startRelay, str, useBins, useCerts, useCleanup, type Suite } from './helpers.ts';

const bins = useBins(['deep-relay', 'deep-relay-suite']);
const certs = useCerts();
useCleanup();

/** This file's own reading of what the suite's connections received: per connection, every frame read field by field. */
function forwarding(s: Suite): { crossed: Array<{ from: string; to: string }>; echoed: string[]; forged: string[]; matches: Map<string, number> } {
  const crossed: Array<{ from: string; to: string }> = [];
  const echoed: string[] = [];
  const forged: string[] = [];
  // Joined connections per match that received at least one frame of their own match.
  const matches = new Map<string, number>();
  s.connections.forEach((c, i) => {
    let own = 0;
    c.sent.forEach((bytes, j) => {
      const f = readFrame(bytes, `connection ${i}'s sent frame ${j}`);
      expect(f.match, `connection ${i}'s sent frame ${j} carries its connection's match ID in its first 16 bytes`).toBe(c.match);
    });
    c.received.forEach((bytes, j) => {
      const f = readFrame(bytes, `connection ${i}'s received frame ${j}`);
      if (f.match !== c.match) { crossed.push({ from: f.match, to: c.match }); return; }
      if (c.player !== null && f.player === c.player) echoed.push(`connection ${i} (player ${c.player}) got its own frame back`);
      const sentByAnother = s.connections.some((o, k) => k !== i && o.match === c.match && o.sent.some((x) => x.equals(bytes)));
      if (!sentByAnother) forged.push(`connection ${i} received a frame of match ${c.match} that no other connection of that match sent`);
      own += 1;
    });
    if (c.player !== null && own > 0) matches.set(c.match, (matches.get(c.match) ?? 0) + 1);
  });
  return { crossed, echoed, forged, matches };
}

describe('#309.1 the shipped relay answers relay@1 with the digest committed in the repo and passes the relay suite', () => {
  it('#309.1 relay@1\'s digest is committed in the repo: packages/contracts/digests.json holds relay@1, frozen from its contract file by the d1 digest', () => {
    const c = committed();
    expect(c.digest, 'packages/contracts/digests.json has an entry relay@1').toBeTypeOf('string');
    expect(c.digest, 'relay@1\'s committed digest is a d1 digest').toMatch(/^d1:[0-9a-f]{64}$/);
    expect(c.file, 'relay@1 has its contract file, packages/contracts/schemas/relay@1.json or slots/relay@1.json').not.toBeNull();
    expect(c.fileDigest, 'the committed digest is the d1 digest of relay@1\'s contract file, so the shape can\'t change under it').toBe(c.digest);
  });

  it('#309.1 the relay suite on the shipped relay (deep-relay on 127.0.0.1): its hello names relay@1 and the committed digest; joining, forwarding only within a match and keeping nothing once a match ends pass; and every frame the suite\'s connections received, read field by field, came from another copy of the same match', async () => {
    const digest = committed().digest;
    const relay = await startRelay(bins.bin('deep-relay'), certs());
    const s = await relaySuite(bins.bin('deep-relay-suite'), relay.url, certs().ca, 'the relay suite on the shipped relay');
    expect(s.relay, 'the report names the relay it ran against').toContain(relay.host);
    expect(s.hello.protocol, 'the shipped relay\'s hello names relay@1').toBe('relay@1');
    expect(digest, 'relay@1\'s digest is committed (packages/contracts/digests.json)').toBeTypeOf('string');
    expect(s.hello.digest, 'the shipped relay\'s hello names the digest committed in the repo').toBe(digest);
    for (const check of ['joining', 'forwarding', 'keeps_nothing']) {
      expect(s.checks[check], `the relay suite runs the check ${check}`).toBeDefined();
      expect(s.checks[check]!.failures, `the shipped relay passes ${check}`).toEqual([]);
      expect(s.checks[check]!.status, `the shipped relay passes ${check}`).toBe('PASS');
    }
    const seen = forwarding(s);
    expect(seen.crossed, 'no frame reached a connection of another match').toEqual([]);
    expect(seen.echoed, 'no frame went back to the copy that sent it').toEqual([]);
    expect(seen.forged, 'every frame a connection received was sent by another copy of its match').toEqual([]);
    const busy = [...seen.matches.entries()].filter(([, n]) => n >= 2);
    expect(busy.length, `the suite played at least two matches at once, each with two copies receiving each other's frames, so forwarding only within a match was tried (${JSON.stringify([...seen.matches])})`).toBeGreaterThanOrEqual(2);
    const ended = s.connections.findIndex((c, i) => c.refused === 'unknown' && s.connections.slice(0, i).some((o) => o.match === c.match && o.player !== null));
    expect(ended, 'a join to a match the suite had played and ended was refused unknown: the relay kept nothing of it').toBeGreaterThanOrEqual(0);
    expect(s.status, 'the shipped relay passes the relay suite').toBe('PASS');
    expect(s.exit, 'deep-relay-suite exits 0 on PASS').toBe(0);
    await relay.stop();
  }, 1_200_000);

  it('#309.1 the local preflight runs the relay suite on the shipped relay: a lane relay runs node scripts/relay-kit.mjs, which exits 0 with the suite PASS on deep-relay', async () => {
    const lane = (await lanes()).find((l) => l.name === 'relay');
    expect(lane, 'scripts/lanes.mjs has a lane named relay in checks (the local preflight)').toBeDefined();
    expect(lane!.commands.some((c) => c.includes('scripts/relay-kit.mjs')), `the lane relay runs scripts/relay-kit.mjs: ${JSON.stringify(lane!.commands)}`).toBe(true);
    const r = await runAsync([process.execPath, 'scripts/relay-kit.mjs'], { timeoutMs: 1_800_000 });
    const kit = obj(obj(lastJson(r.stdout), `scripts/relay-kit.mjs's last stdout line (exit ${r.status}; ${r.stdout.slice(-800)} ${r.stderr.slice(-800)})`)['relay_kit'], 'relay_kit');
    expect(str(kit['suite'], 'relay_kit.suite'), 'the relay suite passes the shipped relay in the lane').toBe('PASS');
    expect(r.status, 'node scripts/relay-kit.mjs exits 0').toBe(0);
  }, 1_800_000);

  it('#309.1 a planted relay that forwards one frame to another match\'s copies (deep-relay --planted forwards_to_other_match) fails the relay suite, naming both match IDs', async () => {
    const relay = await startRelay(bins.bin('deep-relay'), certs(), 'forwards_to_other_match');
    const s = await relaySuite(bins.bin('deep-relay-suite'), relay.url, certs().ca, 'the relay suite on the planted relay');
    const seen = forwarding(s);
    expect(seen.crossed.length, 'this file\'s own reading finds a frame of one match among another match\'s connections\' frames').toBeGreaterThanOrEqual(1);
    const { from, to } = seen.crossed[0]!;
    const failures = Object.values(s.checks).flatMap((c) => c.failures);
    expect(failures.some((f) => f.includes(from) && f.includes(to)), `a failure names both match IDs, the frame's ${from} and the receiving copy's ${to}: ${JSON.stringify(failures).slice(0, 1500)}`).toBe(true);
    expect(s.status, 'the relay suite fails the planted relay').toBe('FAIL');
    expect(s.exit, 'deep-relay-suite exits non-zero on FAIL').not.toBe(0);
    await relay.stop();
  }, 1_200_000);
});
