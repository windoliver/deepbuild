// AC1 #3356.8d8c3ce5 (second half): a release `deep-show live` starts.
//
// The issue's release build (`cargo build --locked --release --bin deep-show`, the committed ledger embedded) started
// as `deep-show live`. "Starts" as main.rs defines it: the seal runs before the first line is read, and a refused set
// answers no line. So `live` is given one line it can't read: a build that sealed reads it and answers `bad_input`
// (exit 0, no window opened); one that refused writes the seal's refusal and exits 2 without reading it.
//
// The wrong program: the base, whose release seal refuses scene3d (`seal_refused`, `kit_failed`, exit 2).
import { describe, expect, it } from 'vitest';
import { AC1, isObject, live, shown, useBuild } from './helpers.ts';

const releaseBin = useBuild('release');

describe(`${AC1} a release deep-show live starts`, () => {
  it(`${AC1} the release deep-show live seals every module it holds, scene3d among them, and reads its first line: it answers bad_input to a line it can't read, exit 0, rather than refusing to seal`, () => {
    const r = live(releaseBin());
    expect(r.timedOut, 'deep-show live answered within 5 minutes').toBe(false);
    const said = `exit ${String(r.status)}; stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr.slice(-1500)}`;
    const refusal = r.lines.find((l) => isObject(l) && l['code'] === 'seal_refused');
    expect(refusal, `deep-show live doesn't refuse to seal: ${refusal ? shown(refusal) : said}`).toBeUndefined();
    expect(r.status, `deep-show live exits 0 after answering its line: ${said}`).toBe(0);
    expect(r.lines.length, `deep-show live answers its one line with one line: ${said}`).toBe(1);
    const answer = r.lines[0];
    expect(isObject(answer) ? answer['code'] : answer, `deep-show live read its line, which isn't a scenario: ${said}`).toBe('bad_input');
  }, 5_400_000);
});
