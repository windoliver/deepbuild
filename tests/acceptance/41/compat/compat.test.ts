// AC13 #41.1d9debfb: "The hub's hello lists its contract version and features; the app and the CLI check them against the
// methods they call and, on a mismatch, show one screen that names which side is older and the one step that fixes
// it." An app newer than the running hub shows one screen naming the hub as older with its fix, and calls nothing the
// hub doesn't list; a planted app that calls an unlisted method fails, naming the method.
//
// Surface assumed (the issue and design name no code surface, so this is the one the tests pin):
//   packages/hub/src/compat.ts exports
//     checkCompat(hello: { contract?: string; features?: string[] }, needs: { contract: string; features: string[] })
//       => { ok: true } | { ok: false; older: 'hub' | 'client'; screen: string; fix: string }
//     guardedCall(hello, method: string, call: () => T | Promise<T>) => Promise<T>
//   - A contract is a dotted number, "major" or "major.minor", compared as numbers ("1.10" is newer than "1.9").
//   - hub older: the hello has no contract, a lower major or minor than the client needs, or the same contract but
//     lacks one of the features the client needs. client older: the hub's major is higher than the client needs.
//     A hub with the same major and an equal or higher minor that lists every needed feature is ok.
//   - `screen` is the one screen's text: it names the older side ("hub" or the client) and ends on exactly one fix
//     step, which is also returned as `fix` (one non-empty line, contained verbatim in `screen`).
//   - guardedCall throws an Error whose message names the method when the hello's features don't list it, and then
//     never invokes `call`; a listed method runs `call` and returns its result.
//   - The real hub's hello line carries `contract`, a string in that format, beside `features`.
// The hub case needs the CLI built (packages/cli/dist/main.js), as every test using packages/hub/test/hub.ts does.

import net from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCompat, guardedCall } from '../../../../packages/hub/src/compat.js';
import { withHub } from '../../../../packages/hub/test/hub.js';

const NEEDS = { contract: '2.1', features: ['rpc.ask', 'rpc.status'] };
const bad = (r: ReturnType<typeof checkCompat>) => { if (r.ok) throw Error('expected a mismatch, got ok'); return r; };

describe('AC13 #41.1d9debfb checkCompat', () => {
  it('AC13 #41.1d9debfb passes a hub of the same contract that lists every needed feature', () => {
    expect(checkCompat({ contract: '2.1', features: ['rpc.ask', 'rpc.status', 'extra'] }, NEEDS)).toEqual({ ok: true });
    expect(checkCompat({ contract: '2.4', features: ['rpc.ask', 'rpc.status'] }, NEEDS)).toEqual({ ok: true });
  });

  it('AC13 #41.1d9debfb names the hub as older, with one fix, when the app is newer than the hub', () => {
    const r = bad(checkCompat({ contract: '1.9', features: ['rpc.ask', 'rpc.status'] }, NEEDS));
    expect(r.older).toBe('hub');
    expect(r.screen).toMatch(/hub/i);
    expect(r.screen).toMatch(/older/i);
    expect(r.screen).toContain('1.9');
    expect(r.screen).toContain('2.1');
    expect(r.fix.trim().length).toBeGreaterThan(0);
    expect(r.fix).not.toMatch(/\n/);
    expect(r.screen).toContain(r.fix);
  });

  it('AC13 #41.1d9debfb compares contract parts as numbers, not text', () => {
    expect(bad(checkCompat({ contract: '2.9', features: ['rpc.ask', 'rpc.status'] }, { ...NEEDS, contract: '2.10' })).older).toBe('hub');
    expect(checkCompat({ contract: '2.10', features: ['rpc.ask', 'rpc.status'] }, { ...NEEDS, contract: '2.9' })).toEqual({ ok: true });
  });

  it('AC13 #41.1d9debfb takes a hello with no contract, or none of the features, as an older hub', () => {
    expect(bad(checkCompat({ features: ['rpc.ask', 'rpc.status'] }, NEEDS)).older).toBe('hub');
    expect(bad(checkCompat({}, NEEDS)).older).toBe('hub');
  });

  it('AC13 #41.1d9debfb names the hub as older when the contract matches but a needed feature is not listed, and names the feature', () => {
    const r = bad(checkCompat({ contract: '2.1', features: ['rpc.ask'] }, NEEDS));
    expect(r.older).toBe('hub');
    expect(r.screen).toContain('rpc.status');
    expect(r.screen).not.toContain('rpc.ask');
  });

  it('AC13 #41.1d9debfb names the client as older when the hub is newer, and does not call the hub older', () => {
    const r = bad(checkCompat({ contract: '3.0', features: ['rpc.ask', 'rpc.status'] }, NEEDS));
    expect(r.older).toBe('client');
    expect(r.screen).toMatch(/older/i);
    expect(r.screen).not.toMatch(/hub[^.\n]{0,40}\bolder/i);
    expect(r.screen).toContain(r.fix);
    expect(r.fix).not.toMatch(/\n/);
  });

  it('AC13 #41.1d9debfb gives different fixes for the two sides', () => {
    const hubOlder = bad(checkCompat({ contract: '1.0', features: [] }, NEEDS));
    const clientOlder = bad(checkCompat({ contract: '3.0', features: [...NEEDS.features] }, NEEDS));
    expect(hubOlder.fix).not.toBe(clientOlder.fix);
  });
});

describe('AC13 #41.1d9debfb guardedCall', () => {
  const hello = { contract: '2.1', features: ['rpc.ask', 'rpc.status'] };

  it('AC13 #41.1d9debfb refuses a method the hub does not list, names it, and never calls it', async () => {
    let called = 0;
    await expect(guardedCall(hello, 'rpc.delete_everything', () => { called++; return 1; })).rejects.toThrow(/rpc\.delete_everything/);
    expect(called).toBe(0);
  });

  it('AC13 #41.1d9debfb refuses every method when the hello lists no features, or the hello has none', async () => {
    let called = 0;
    await expect(guardedCall({ contract: '1.0', features: [] }, 'rpc.ask', () => { called++; })).rejects.toThrow(/rpc\.ask/);
    await expect(guardedCall({}, 'rpc.ask', () => { called++; })).rejects.toThrow(/rpc\.ask/);
    expect(called).toBe(0);
  });

  it('AC13 #41.1d9debfb runs a listed method and returns what it returned', async () => {
    let called = 0;
    const got = await guardedCall(hello, 'rpc.status', async () => { called++; return { up: true }; });
    expect(got).toEqual({ up: true });
    expect(called).toBe(1);
  });

  it('AC13 #41.1d9debfb matches a method name exactly, not by prefix', async () => {
    let called = 0;
    await expect(guardedCall(hello, 'rpc.stat', () => { called++; })).rejects.toThrow(/rpc\.stat\b/);
    expect(called).toBe(0);
  });
});

describe('AC13 #41.1d9debfb the running hub', () => {
  it('AC13 #41.1d9debfb lists a contract version and its features in its hello', async () => {
    await withHub(async (root) => {
      const hello = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const s = net.connect(join(root, 'hub.sock'));
        let got = '';
        s.on('data', (d) => { got += d; const i = got.indexOf('\n'); if (i >= 0) { s.destroy(); resolve(JSON.parse(got.slice(0, i)) as Record<string, unknown>); } });
        s.on('error', reject);
      });
      expect(hello.hello).toBe('deep-hub');
      expect(typeof hello.contract).toBe('string');
      expect(hello.contract).toMatch(/^\d+(\.\d+)?$/);
      expect(Array.isArray(hello.features)).toBe(true);
      // What the hub lists is what a client's check reads: the real hello is accepted by a client that needs nothing more.
      expect(checkCompat(hello as { contract?: string; features?: string[] }, { contract: String(hello.contract), features: [] })).toEqual({ ok: true });
      expect(bad(checkCompat(hello as { contract?: string; features?: string[] }, { contract: '999.0', features: [] })).older).toBe('hub');
    });
  }, 120_000);
});
