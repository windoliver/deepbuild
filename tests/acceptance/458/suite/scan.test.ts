// #458 criterion 6: a planted API key, a planted /Users/ path and a planted character name from the scan's list
// each fail the fixture scan naming the file and line, and their clean twins pass. The Scope's other two local
// paths, /private/tmp/ and /Volumes/, are planted beside the /Users/ one. Every planted value is put together here
// at run time and written to a temporary fixture tree, so no committed file holds one (README: The fixture scan).
// The wrong programs are the base, which has no fixture scan, a scan that reads no evidence file, one that knows no
// name, and one that fails every file: the clean tree is the planted tree with only the planted values changed.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { AC, TIMEOUT, scan } from './helpers.ts';

// The planted values, never written whole in this file. The key has the shape the repo's own secrets rule calls an
// API key; the name is the made-up character name the scan's list holds for this test (README).
const KEY = ['sk', 'deepbuild458fixture0123456789'].join('-');
const USERS = ['', 'Users', 'someone', 'work', 'shot.png'].join('/');
const PRIVATE_TMP = ['', 'private', 'tmp', 'deep-run', 'frame.png'].join('/');
const VOLUMES = ['', 'Volumes', 'Scratch', 'frame.png'].join('/');
const NAME = ['Vexlorn', 'Dramble'].join(' ');

interface Values { key: string; users: string; privateTmp: string; volumes: string; name: string }
const PLANTED: Values = { key: KEY, users: USERS, privateTmp: PRIVATE_TMP, volumes: VOLUMES, name: NAME };
const CLEAN: Values = { key: '<key>', users: '~/work/shot.png', privateTmp: '<tmp>/frame.png', volumes: '<volume>/frame.png', name: 'A figure' };

const DOCUMENT = 'parity/marks2d/hero.board.json';
const SIDECAR = 'parity/marks2d/hero.board.sidecar.json';
const EVIDENCE = 'evidence/marks2d/hero.board.quick.log';
/** A fixture, its sidecar and its evidence. Each planted value sits on a line of its own, named below. */
const files = (v: Values): Record<string, string> => ({
  [DOCUMENT]: [
    '{',
    '  "format": 1,',
    '  "profile": "board",',
    `  "title": "${v.name} crosses the bridge",`, // line 4
    '  "description": "One figure walks across a bridge at dusk.",',
    '  "size": [320, 200],',
    '  "items": {}',
    '}',
    '',
  ].join('\n'),
  [SIDECAR]: [
    '{',
    '  "checks": [],',
    '  "codes": [],',
    `  "inputs": [{"step": 1, "kind": "token", "value": "${v.key}"}]`, // line 4
    '}',
    '',
  ].join('\n'),
  [EVIDENCE]: [
    'quick lane, parity/marks2d/hero.board',
    'rendered 320 x 200 on vello_cpu',
    `snapshot written to ${v.users}`, // line 3
    `scratch copy at ${v.privateTmp}`, // line 4
    `compared with ${v.volumes}`, // line 5
    'PASS',
    '',
  ].join('\n'),
});
const FINDINGS: [string, number, string][] = [
  [SIDECAR, 4, 'the planted API key'],
  [EVIDENCE, 3, 'the planted /Users/ path'],
  [DOCUMENT, 4, 'the planted character name'],
  [EVIDENCE, 4, 'the planted /private/tmp/ path'],
  [EVIDENCE, 5, 'the planted /Volumes/ path'],
];

function tree(v: Values): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-458-scan-')));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files(v))) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe(`${AC[6]} the fixture scan fails each planted value, naming the file and line, and passes the clean twins`, () => {
  it(`${AC[6]} a planted API key, a planted /Users/ path and a planted character name from the scan's list, and a /private/tmp/ and a /Volumes/ path, each fail the scan naming the file and line; the same tree with the values changed passes; a folder that isn't there doesn't pass`, () => {
    const planted = scan(tree(PLANTED));
    expect(planted.status, `the scan fails the planted tree: ${planted.out}`).not.toBe(0);
    const found = planted.lines.filter((line) => line.startsWith('FAIL fixture scan: '));
    for (const [path, line, what] of FINDINGS) {
      expect(found.filter((f) => f.includes(`${path}:${line}:`)).length, `${what} is one finding, naming ${path}:${line}: ${planted.out}`).toBe(1);
    }
    expect(planted.lines.filter((line) => line.startsWith('FAIL')).length, `the scan finds the ${FINDINGS.length} planted values and nothing else: ${planted.out}`).toBe(FINDINGS.length);

    const clean = scan(tree(CLEAN));
    expect(clean.lines.filter((line) => line.startsWith('FAIL')), `the clean twins raise no finding: ${clean.out}`).toEqual([]);
    expect(clean.status, `the scan passes the clean twins: ${clean.out}`).toBe(0);

    const absent = scan(join(tree(CLEAN), 'absent'));
    expect(absent.status, `a folder that isn't there isn't scanned, so it doesn't pass: ${absent.out}`).not.toBe(0);
  }, TIMEOUT);
});
