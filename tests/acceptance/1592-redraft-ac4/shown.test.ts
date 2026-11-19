// #1592 AC4, redrafted blind (README): "Shown to you: a contact sheet of every state mark and icon in light and dark,
// taken by the check run from the real app, is attached to the PR and shown to you. Whether it looks right is one taste
// call, recorded; without it the run stays INCONCLUSIVE, never PASS".
//
// The check run builds the real `deep-app` with its `contact-sheet` probe (a Cargo feature in no shipped build) and runs
// `deep-app --contact-sheet <png>` twice, with DEEP_APP_APPEARANCE=light and =dark, each in a temp HOME. The app opens its
// real window on this Mac's screen holding the mark of every status-map entry and every icon of its icon set at 14 and
// at 16, reads back the frame that window presented (no screen permission) into the PNG and prints one report line naming
// what it drew where. The pictures and run.json go to $DA1592_SHEETS, or a temp folder without it. Then TASTE.json is
// read: no call, or a call on other files, is INCONCLUSIVE; `looks_wrong` fails, quoting its note; `looks_right` on
// exactly this run's files passes. A kept folder holding exactly a recorded call's files, from this same app binary,
// stands, so the run doesn't take them again. "Attached to the PR and shown to you" is the implementing agent's; no test
// can see it. Nothing here judges a picture.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ID = '#1592.15a3cc5f';
const SUITE = dirname(fileURLToPath(import.meta.url));
const REPO = join(SUITE, '..', '..', '..');
const MIN = 60_000;
/** The status map's entries (design: Look `look@1`, `status`; States people see): one mark each. */
const ENTRIES = ['pass', 'fail', 'invalid', 'blocked', 'inconclusive', 'running', 'needs_you', 'stale', 'idle'];
/** The icon sizes (the issue: 14 in rows, 16 in page chrome). */
const SIZES = [14, 16];
const APPEARANCES = ['light', 'dark'] as const;
type Appearance = (typeof APPEARANCES)[number];
const picture = (a: Appearance): string => `contact-${a}.png`;
const FILES = [...APPEARANCES.map(picture), 'run.json'].sort();
const BUILD = ['build', '--locked', '-p', 'deep-app', '--bin', 'deep-app', '--features', 'contact-sheet'];

const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const same = (a: Record<string, string>, b: Record<string, string>): boolean =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/** One report line of `deep-app --contact-sheet` (README: Surface choices), as printed; other fields are ignored. */
interface Sheet {
  contact_sheet?: unknown; appearance?: unknown; scale?: unknown; window?: unknown; png?: unknown;
  marks?: { entry?: unknown; rect?: unknown }[]; icons?: { name?: unknown; size?: unknown; rect?: unknown }[];
}
interface Run { issue: number; criterion: string; app: string; reports: Record<Appearance, Sheet> }
interface Taste { issue?: number; criterion?: string; verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }

/** The real app with its contact-sheet probe, built once and copied out of the target folder into `dir`. */
function build(dir: string): string {
  const r = spawnSync('cargo', BUILD, {
    cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' },
  });
  if (r.error) blocked(`cargo could not run: ${r.error.message}`);
  const said = (r.stderr ?? '').split('\n').filter((l) => !/^\s*(Compiling|Finished|Blocking|Download|Updating|Locking)/.test(l)).join('\n').trim();
  const missing = /feature[^\n]*contact-sheet/.test(said) ? 'crates/deep-app/Cargo.toml has no feature contact-sheet, so the real app has no contact sheet to draw (README: Surface choices). ' : '';
  expect(r.status, `${missing}cargo ${BUILD.join(' ')} builds the real app with its contact sheet:\n${said.slice(-3000)}`).toBe(0);
  const bin = join(dir, 'deep-app');
  copyFileSync(join(resolve(REPO, process.env.CARGO_TARGET_DIR ?? 'target'), 'debug', 'deep-app'), bin);
  return bin;
}

/** `DEEP_APP_APPEARANCE=<a> deep-app --contact-sheet <png>` in a temp HOME: its report line, without the PNG's path. */
function take(bin: string, a: Appearance, png: string): Sheet {
  const home = mkdtempSync(join(tmpdir(), 'da1592-home-'));
  try {
    rmSync(png, { force: true });
    const args = ['--contact-sheet', png];
    const r = spawnSync(bin, args, {
      cwd: home, encoding: 'utf8', timeout: 5 * MIN, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, HOME: home, DEEP_APP_APPEARANCE: a },
    });
    expect(r.status, `DEEP_APP_APPEARANCE=${a} deep-app ${args.join(' ')} exits 0 (${r.signal ?? 'no signal'}): ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
    const line = (r.stdout ?? '').split('\n').reverse().map((l): unknown => { try { return JSON.parse(l); } catch { return null; } })
      .find((v): v is Sheet => typeof v === 'object' && v !== null && (v as Sheet).contact_sheet === 1592);
    expect(line, `deep-app prints its report line {"contact_sheet": 1592, …}: ${(r.stdout ?? '').slice(-800)}`).toBeDefined();
    if (!existsSync(png)) expect.fail(`the ${a} sheet wasn't written at ${png}; the report's png: ${JSON.stringify(line!.png)}`);
    return Object.fromEntries(Object.entries(line!).filter(([k]) => k !== 'png')) as Sheet;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** A PNG's width and height from its header; null for a file that isn't one. */
function pngSize(path: string): [number, number] | null {
  const b = readFileSync(path);
  return b.length >= 24 && b.toString('latin1', 1, 4) === 'PNG' && b.toString('latin1', 12, 16) === 'IHDR' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;
}
const inside = (rect: unknown, [w, h]: number[]): boolean => Array.isArray(rect) && rect.length === 4
  && rect.every((v) => typeof v === 'number' && Number.isFinite(v)) && rect[2] > 0 && rect[3] > 0
  && rect[0] >= 0 && rect[1] >= 0 && rect[0] + rect[2] <= w! && rect[1] + rect[3] <= h!;

/** What one appearance's sheet lacks: a mark of a status-map entry, an icon at 14 or 16, or its place in the picture. */
function lacks(a: Appearance, sheet: Sheet, png: string, icons: string[]): string[] {
  const f: string[] = [];
  const at = `the ${a} sheet`;
  if (sheet.appearance !== a) f.push(`${at}'s report says it drew ${JSON.stringify(sheet.appearance)}, not ${a}`);
  const win = sheet.window;
  if (!Array.isArray(win) || win.length !== 2 || !win.every((v) => typeof v === 'number' && v > 0)) return [...f, `${at}'s report gives no window [w, h] in points: ${JSON.stringify(win)}`];
  const scale = typeof sheet.scale === 'number' ? sheet.scale : NaN;
  const size = pngSize(png);
  if (!size) f.push(`${at} at ${png} isn't a PNG`);
  else if (size[0] !== Math.round(win[0] * scale) || size[1] !== Math.round(win[1] * scale)) f.push(`${at} is ${size[0]} × ${size[1]} px, not its ${win[0]} × ${win[1]} pt window at scale ${String(sheet.scale)}`);
  const marks = Array.isArray(sheet.marks) ? sheet.marks : [];
  for (const entry of ENTRIES) if (!marks.some((m) => m?.entry === entry)) f.push(`${at} has no mark for the status-map entry ${entry}`);
  for (const m of marks) {
    if (!ENTRIES.includes(m?.entry as string)) f.push(`${at} has a mark for ${JSON.stringify(m?.entry)}, which is no status-map entry`);
    else if (!inside(m.rect, win)) f.push(`${at}'s ${String(m.entry)} mark isn't inside its window: ${JSON.stringify(m.rect)}`);
  }
  const drawn = Array.isArray(sheet.icons) ? sheet.icons : [];
  for (const name of icons) for (const s of SIZES) if (!drawn.some((i) => i?.name === name && i.size === s)) f.push(`${at} has no ${name} icon at ${s}`);
  for (const i of drawn) {
    if (typeof i?.name !== 'string' || i.name === '') f.push(`${at} has an icon with no name: ${JSON.stringify(i)}`);
    else if (!inside(i.rect, win)) f.push(`${at}'s ${i.name} icon at ${String(i.size)} isn't inside its window: ${JSON.stringify(i.rect)}`);
  }
  return f;
}

describe(`AC4 ${ID} a contact sheet shown to you`, () => {
  it(`AC4 ${ID}: the check run takes a contact sheet of every state mark and icon in light and dark from the real app, and reads INCONCLUSIVE unless a recorded taste call on exactly these files says it looks right`, () => {
    if (process.platform !== 'darwin') blocked(`the app draws on macOS only; this is ${process.platform}`);
    const out = process.env.DA1592_SHEETS ? resolve(process.env.DA1592_SHEETS) : mkdtempSync(join(tmpdir(), 'da1592-sheets-'));
    mkdirSync(out, { recursive: true });
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    const bins = mkdtempSync(join(tmpdir(), 'da1592-bin-'));
    try {
      const bin = build(bins);
      const app = sha256(bin);
      const runFile = join(out, 'run.json');
      const files = (): Record<string, string> => Object.fromEntries(FILES.filter((f) => existsSync(join(out, f))).map((f) => [f, sha256(join(out, f))]));
      const kept = Object.keys(files()).length === FILES.length && same(files(), taste.files ?? {})
        && (JSON.parse(readFileSync(runFile, 'utf8')) as Partial<Run>).app === app;
      let reports: Record<Appearance, Sheet>;
      if (kept) {
        reports = (JSON.parse(readFileSync(runFile, 'utf8')) as Run).reports;
      } else {
        rmSync(runFile, { force: true });
        reports = { light: take(bin, 'light', join(out, picture('light'))), dark: take(bin, 'dark', join(out, picture('dark'))) };
        const run: Run = { issue: 1592, criterion: 'AC4', app, reports };
        writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`);
      }
      const got = files();
      expect(Object.keys(got).sort(), `the run wrote both sheets and run.json to ${out} (there: ${readdirSync(out).join(', ')})`).toEqual(FILES);
      console.log(`AC4 ${ID}: the contact sheets from this run${kept ? ' (kept: a recorded call\'s files from this same app)' : ''} in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);

      const icons = [...new Set(APPEARANCES.flatMap((a) => (Array.isArray(reports[a]?.icons) ? reports[a].icons : []).map((i) => i?.name)))]
        .filter((n): n is string => typeof n === 'string' && n !== '').sort();
      const failures = [
        ...(icons.length ? [] : ['neither sheet shows an icon: the icon set the chrome draws is missing']),
        ...(got[picture('light')] === got[picture('dark')] ? ['the light and dark sheets are the same picture'] : []),
        ...APPEARANCES.flatMap((a) => lacks(a, reports[a] ?? {}, join(out, picture(a)), icons)),
      ];
      expect(failures, 'each sheet holds the mark of every status-map entry and every icon at 14 and 16, inside the picture of the real window').toEqual([]);
      for (const a of APPEARANCES) if (reports[a].scale !== 2) inconclusive(`AC4: the ${a} sheet was drawn at scale ${String(reports[a].scale)}, not 2: this Mac's display can't show it as the reference Mac does`);

      if (taste.verdict !== 'looks_right' && taste.verdict !== 'looks_wrong') inconclusive(`AC4: no taste call is recorded on these contact sheets (TASTE.json's verdict is ${JSON.stringify(taste.verdict ?? null)})`);
      if (taste.issue !== 1592 || taste.criterion !== 'AC4' || !taste.who || !taste.when) inconclusive('AC4: the taste call in TASTE.json isn\'t one for #1592 AC4 that names who made it and when');
      if (!same(taste.files ?? {}, got)) inconclusive('AC4: the recorded taste call was made on other files than this run\'s');
      expect(taste.verdict, `the recorded taste call says the contact sheet doesn't look right: ${taste.note ?? ''}`).toBe('looks_right');
    } finally {
      rmSync(bins, { recursive: true, force: true });
    }
  }, 180 * MIN);
});
