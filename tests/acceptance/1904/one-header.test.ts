// #1904 AC2: the sources hold one function that sets the authorization header for GitHub, so a planted second fails
// this test. It reads every hand-written TypeScript source under packages/*/src (tests left out) and counts the places
// that set an HTTP `authorization` header to a bearer value (README, The AC2 pattern), in files that are about GitHub.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const AC2 = '#1904.9f3f4bff';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * An `authorization` header given a bearer value: an object key (`authorization: \`Bearer …\``, quoted or not), a
 * property set (`headers.authorization = …`) or a Headers call (`.set('authorization', …)`), the value a string that
 * starts `Bearer `. Git's `http.extraHeader` value (`\`Authorization: Bearer …\``, one string) doesn't match: the
 * quote opens before `Authorization`, not before `Bearer`.
 */
const SETS_BEARER = /\bauthorization['"]?\s*[:=,]\s*[`'"]Bearer /gi;
/** A file about GitHub: it names it. Slack's, channels' and sources' own auth headers live in files that don't. */
const GITHUB = /github/i;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : sources(path);
    return /\.(?:ts|mts|cts|tsx)$/.test(e.name) && !/\.d\.ts$|\.test\.tsx?$|\.spec\.tsx?$/.test(e.name) ? [path] : [];
  });
}

it(`${AC2} exactly one place in packages/*/src sets GitHub's authorization header`, () => {
  const packages = join(ROOT, 'packages');
  const files = readdirSync(packages, { withFileTypes: true }).filter((e) => e.isDirectory())
    .flatMap((e) => { try { return sources(join(packages, e.name, 'src')); } catch { return []; } });
  const sites = files.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    if (!GITHUB.test(text)) return [];
    return text.split('\n').flatMap((line, n) => [...line.matchAll(SETS_BEARER)].map(() => `${relative(ROOT, file)}:${n + 1}`));
  });
  expect(sites.length, `the places that set a bearer authorization header for GitHub: ${sites.join(', ')}`).toBe(1);
}, 30_000);
