// AC3 #70.18ce54cd: a secret entered through the CLI lands in the Secret Service and never in a file or a log.
//
// The issue's Proof asks for a round trip, so it runs on real parts: the hub as the systemd user service, the real
// Secret Service on the session bus, `deep secret add` typed into a real pseudo-terminal. The value goes in through
// the CLI and is read out by `secret-tool`, a reader DeepBuild doesn't own. Coming back, the hub says it holds the
// secret, and stops saying so once `secret-tool` clears the item, so a copy kept anywhere else fails. Everything a
// value could leak to is searched in each form the Privacy scrub knows: the world's files (the record, its write-ahead
// log, evidence, logs, spool, TMPDIR), what the terminal showed, the service's journal, the hub's command line and
// environment. A control shows the search finds what it looks for.
//
// Scope and Decided add that a new secret counts only after polkit confirms you, never on the peer check alone: with
// the prompt cancelled, nothing lands.

import { spawn } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packageDigest } from '../../../packages/extension-host/src/index.ts';
import {
  AC3, CLI, FIXTURES, NODE, childEnv, cleanup, confirmWith, deep, journal, jsonLines, mainPid, makeHome, own, requireBubblewrap, requireSecretService, requireService, secretTool, shown,
  startService, tag, type Home, type Ran,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const PACKAGE = 'test/vault';
const NAME = 'vault_key';
/** Where the store keeps it, the same key as on macOS (`keychainStore`): README, assumption 5. */
const ITEM = ['service', 'deepbuild.secret', 'account', `deepbuild/${PACKAGE}/${NAME}`];

/** The forms the Privacy scrub knows a value by. */
const forms = (value: string): string[] => [value, Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url'), Buffer.from(value).toString('hex'), encodeURIComponent(value)];
const holds = (text: string | Buffer, value: string): boolean => forms(value).some((form) => (typeof text === 'string' ? Buffer.from(text) : text).includes(form));
/** Every regular file under `dir` that holds `value` in any of its forms. */
function filesHolding(dir: string, value: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = lstatSync(path, { throwIfNoEntry: false });
    if (st?.isDirectory()) found.push(...filesHolding(path, value));
    else if (st?.isFile() && holds(readFileSync(path), value)) found.push(path);
  }
  return found;
}

/** The test package that names the secret, stamped with its digest and installed through `deep install`, polkit confirming. */
async function installVault(h: Home): Promise<void> {
  const dir = join(h.tmp, 'vault');
  cpSync(join(FIXTURES, 'vault'), dir, { recursive: true });
  renameSync(join(dir, 'index.ts.fixture'), join(dir, 'index.ts'));
  const manifest = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as { digest: string };
  manifest.digest = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  confirmWith(h, 'confirmed');
  const installed = await deep(h, ['install', dir]);
  confirmWith(h, 'cancelled');
  // Not BLOCKED: `deep install` counts only once polkit confirms you, so a hub with no polkit path fails here for that reason.
  if (installed.code !== 0) throw Error(`${AC3} deep install, polkit confirming you, must install and load the package that names the secret: ${shown(installed)}`);
}

/**
 * `deep secret add <package> <name>` in a real pseudo-terminal (fixtures/tty.py), the value typed once the CLI prompts,
 * as a person types it. A CLI that leaves echo on shows the value, and that counts as a leak.
 */
function typed(h: Home, value: string): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-I', join(FIXTURES, 'tty.py'), NODE, CLI, 'secret', 'add', PACKAGE, NAME], { cwd: h.tmp, env: childEnv(h), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    child.on('error', (error) => reject(Error(`BLOCKED: python3 is needed for a real terminal: ${error.message}`)));
    child.stdin.on('error', () => undefined);
    let stdout = '';
    let stderr = '';
    let sent = false;
    const send = () => { if (!sent) { sent = true; child.stdin.write(`${value}\n`); } };
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      stdout += d;
      if (/(value|secret|key)[^\n]*[:?]\s*$/i.test(stdout)) setTimeout(send, 300);
    });
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const prompt = setTimeout(send, 10_000);
    const stop = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('close', (code, signal) => { clearTimeout(prompt); clearTimeout(stop); resolve({ code, signal, stdout, stderr, timedOut: false }); });
  });
}

/** What the real Secret Service holds under DeepBuild's service name, secrets included, as secret-tool prints it. */
const stored = (): string => { const r = secretTool(['search', '--all', '--unlock', 'service', 'deepbuild.secret']); return `${r.stdout}${r.stderr}`; };
/** The secrets the hub says it holds: `deep secret list --json`, one JSON line each, `{secret, provider}`. */
async function held(h: Home): Promise<string[]> {
  const r = await deep(h, ['secret', 'list', '--json']);
  expect(r.code, `deep secret list --json exits 0: ${shown(r)}`).toBe(0);
  return jsonLines(r.stdout).map((l) => String(l.secret));
}

describe(`${AC3} A secret entered through the CLI lands in the Secret Service and never in a file or a log`, () => {
  it(`${AC3} with the prompt cancelled nothing lands; once polkit confirms you the value typed into deep secret add lands in the real Secret Service, comes back through the hub, and no file, log, terminal or process listing holds it`, async () => {
    requireService();
    requireBubblewrap();
    requireSecretService();
    const value = `dh70/${tag(12)}+=`;
    secretTool(['clear', ...ITEM]);
    const h = makeHome();
    try {
      await startService(h);
      await installVault(h);

      // The search finds a copy in each form: a planted file holds the base64 of a twin value.
      const canary = `dh70/${tag(12)}+=`;
      mkdirSync(join(h.home, 'canary'));
      writeFileSync(join(h.home, 'canary', 'copy'), Buffer.from(canary).toString('base64'));
      expect(filesHolding(h.base, canary), 'the control: the file search must find a planted copy, or it proves nothing').toEqual([join(h.home, 'canary', 'copy')]);
      rmSync(join(h.home, 'canary'), { recursive: true });

      // The prompt cancelled: nothing lands, and the CLI exits 3 (not decided).
      const cancelled = await typed(h, value);
      expect(cancelled.code, `${AC3} deep secret add with the polkit prompt cancelled exits 3 (not decided): ${shown(cancelled)}`).toBe(3);
      expect(stored(), `${AC3} with the polkit prompt cancelled, nothing lands in the Secret Service`).not.toContain(value);

      // Confirmed: it lands in the store.
      confirmWith(h, 'confirmed');
      const entered = await typed(h, value);
      expect(entered.code, `${AC3} deep secret add, polkit confirming you, exits 0: ${shown(entered).replaceAll(value, '<the value>')}`).toBe(0);
      const item = stored();
      expect(item, `${AC3} the value must land in the Secret Service under ${ITEM.join(' ')}; secret-tool reads no such item`).toContain(`secret = ${value}`);
      expect(item, `${AC3} the item names the secret`).toContain(`deepbuild/${PACKAGE}/${NAME}`);

      // It comes back through the hub, from the store: cleared there, the hub no longer holds it.
      expect(await held(h), `${AC3} the hub, a systemd user service, reads the secret back from the Secret Service`).toEqual([NAME]);

      // Nowhere else, in any form.
      const leaks: string[] = filesHolding(h.base, value);
      if (holds(`${cancelled.stdout}${cancelled.stderr}${entered.stdout}${entered.stderr}`, value)) leaks.push('what the terminal showed');
      if (holds(journal(), value)) leaks.push('the hub service\'s journal');
      for (const part of ['cmdline', 'environ']) if (holds(readFileSync(`/proc/${mainPid()}/${part}`), value)) leaks.push(`the hub's /proc ${part}`);
      if (leaks.length) throw Error(`${AC3} the value must live in the Secret Service alone; it was also in: ${leaks.join(', ')}`);

      const cleared = secretTool(['clear', ...ITEM]);
      expect(cleared.status, `secret-tool clear: ${cleared.stderr}`).toBe(0);
      expect(await held(h), `${AC3} with the item cleared from the Secret Service the hub must stop holding it; a hub that still does keeps a copy of its own`).toEqual([]);
    } finally {
      secretTool(['clear', ...ITEM]);
    }
  }, 600_000);
});
