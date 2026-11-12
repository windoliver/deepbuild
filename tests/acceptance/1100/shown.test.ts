// AC15: Shown to you. The check run takes the first-launch screen from the real app (`deep-app`, as `cargo build -p
// deep-app` builds it) at the reference window, 1512 × 982 points at 2×, light, on the journey's fixture machine: Claude
// Code and Codex installed, pi absent. The app is read from outside its process with #1454's driver and probe; the
// picture is taken only once the window's tree holds Set up, Claude Code and Codex and nothing naming pi. It goes to
// $DA1100_SCREENS (a temp folder without it) with run.json, the app's SHA-256. Then TASTE.json is read: no call, or one
// on other files, is INCONCLUSIVE; `looks_wrong` fails, quoting its note; `looks_right` on exactly these files passes. A
// kept folder holding exactly a recorded call's files, from this same app binary, stands, so the run doesn't take them
// again. "Attached to the PR and shown to you" is the implementing agent's; no test can see it. Nothing here judges a
// picture, and no other criterion reads one.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { App, appBinary, named, settled, useCleanup } from '../1454/helpers.ts';
import {
  childEnv, cleanup, ID, inconclusive, makeHome, MIN, onMac, sha256File, sortedFiles, SUITE, tempDir, type Taste,
} from './helpers.ts';

useCleanup();
afterAll(cleanup, 120_000);
const PICTURE = 'first-launch-1512x982-light.png';
const expected = (): string[] => [PICTURE, 'run.json'].sort();

/** What's missing for the picture: the window's tree must show the state it's taken in. */
async function notYet(app: App): Promise<string[]> {
  const names = named(await app.tree());
  const out: string[] = [];
  if (!names.some((n) => n.role === 'AXButton' && n.name === 'Set up')) out.push('no Set up button');
  for (const agent of ['Claude Code', 'Codex']) if (!names.some((n) => n.name.includes(agent))) out.push(`nothing names ${agent}`);
  const pi = names.find((n) => /(^|[^\w-])pi([^\w-]|$)/i.test(n.name));
  if (pi) out.push(`${pi.role} "${pi.name}" names pi`);
  return out;
}

async function picture(binary: string, out: string): Promise<string[]> {
  const h = makeHome({ history: true });
  const env = childEnv(h);
  const pass = Object.fromEntries(['SHELL', 'PATH', 'DEEP_HUB_LAUNCHER', 'DEEP_TEST_LAUNCHER_LOG', 'DEEP_HUB_TEST_CONFIRM'].map((k) => [k, String(env[k])]));
  const app = await App.launch({ home: h.home, binary, env: { ...pass, DEEP_APP_APPEARANCE: 'light' } });
  try {
    const missing = await settled(() => notYet(app), 60_000);
    if (missing.length) return missing.map((m) => `the first-launch screen at 1512 × 982: ${m}`);
    const shot = await app.capture('first-launch');
    if (shot.width !== 3024 || shot.height !== 1964) inconclusive(`AC15: the picture is ${shot.width} × ${shot.height} px, not 3024 × 1964: this Mac's screen can't take the reference window at 2×`);
    copyFileSync(shot.path, join(out, PICTURE));
    return [];
  } finally {
    await app.stop();
  }
}

describe(`AC15 ${ID.shown} shown to you`, () => {
  it(`AC15 ${ID.shown}: the check run takes the first-launch screen with Claude Code and Codex named and pi absent from the real app at the reference window, and reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right`, async () => {
    onMac();
    const out = process.env.DA1100_SCREENS ?? tempDir();
    mkdirSync(out, { recursive: true });
    const binary = await appBinary();
    const app = sha256File(binary);
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries(expected().filter((f) => existsSync(join(out, f))).map((f) => [f, sha256File(join(out, f))]));
    const runFile = join(out, 'run.json');
    const kept = existsSync(runFile) && (JSON.parse(readFileSync(runFile, 'utf8')) as { app?: string }).app === app && sortedFiles(files()) === sortedFiles(taste.files ?? {});
    if (!kept) {
      expect(await picture(binary, out), "the state is on the real window's tree before its picture is taken").toEqual([]);
      writeFileSync(runFile, `${JSON.stringify({ issue: 1100, criterion: ID.shown, app })}\n`);
    }
    const got = files();
    expect(Object.keys(got), `the run wrote the picture and run.json to ${out} (there: ${readdirSync(out).join(', ')})`).toEqual(expected());
    console.log(`AC15: the picture from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    if (taste.verdict === null || taste.verdict === undefined) inconclusive('AC15: no taste call is recorded for this picture (TASTE.json holds none)');
    if (!taste.who || !taste.when) inconclusive('AC15: the taste call names no one or no time');
    if (sortedFiles(taste.files ?? {}) !== sortedFiles(got)) inconclusive("AC15: the recorded taste call was made on other files than this run's");
    expect(taste.verdict, `the recorded taste call says they don't look right: ${taste.note ?? ''}`).toBe('looks_right');
  }, 60 * MIN);
});
