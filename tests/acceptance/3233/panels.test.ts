// AC2 #3233.c6c7b61c, AC3 #3233.dd2321b3, AC4 #3233.5531067a and AC5 #3233.e6784a2a: the three rules at pack check and
// at load, a panel driven by key in a replica, and a panel installed against revision 1.
//
// The suite's Rust half (app/probe.rs) runs each fixture panel through the real pack check (`deep_replica::kit::panel`)
// and the real loader (`deep_app::mount_panel`) once, and writes what they gave; the judges (judges.ts) decide here,
// under each criterion's ID. Every ratio is computed here from the two colors; the look's fills come from its own file.
// The two planted hosts are test code in app/probe.rs (README, Planted things): each test of one first holds the real
// program to the same judge, which it must pass.
import { beforeAll, describe, expect, it } from 'vitest';
import { AC2, AC3, AC4, AC5, BUILD_MS, probe, probed, shippedFills } from './helpers.ts';
import { contrast, driveProblems, failingFills, FLOOR, listingProblems, loadRefuses, loads, names, packRefuses, stillLoads } from './judges.ts';

/** The id of the element the press fixtures draw: what a refusal names the node by. */
const NODE = 'refresh-control';

let found: ReturnType<typeof probe>;
beforeAll(() => { found = probe(); }, BUILD_MS);
const of = (name: string) => probed(found, name);

describe(`AC2 ${AC2} names what it presses`, () => {
  const want = { code: 'no_name', node: NODE };
  it(`AC2 ${AC2} a div that takes a press and holds no text is refused at pack check, naming the node and no_name`, () => {
    expect(packRefuses('nameless-press', of('nameless-press'), want)).toEqual([]);
  });
  it(`AC2 ${AC2} a div that takes a press and holds no text is refused again at load, naming the node and no_name`, () => {
    expect(loadRefuses('nameless-press', of('nameless-press'), want)).toEqual([]);
  });
  it(`AC2 ${AC2} the same div holding the text "Refresh" loads (it does at the base too: the rule must not refuse a named press)`, () => {
    expect(loads('named-press', of('named-press'), 'Refresh')).toEqual([]);
  });
  it(`AC2 ${AC2} a Button whose only label is "button" is refused at pack check and at load, naming the node and no_name`, () => {
    const button = { code: 'no_name', node: 'button' };
    expect([...packRefuses('button-label', of('button-label'), button), ...loadRefuses('button-label', of('button-label'), button)]).toEqual([]);
  });
});

describe(`AC3 ${AC3} reads on its fill`, () => {
  it(`AC3 ${AC3} text #9a9a9a on a bg of #ffffff is refused at pack check and at load, naming both colors and the ratio under 4.5`, () => {
    const ratio = contrast('#9a9a9a', '#ffffff');
    expect(ratio, 'by the look\'s formula, #9a9a9a on #ffffff is under the floor').toBeLessThan(FLOOR);
    const want = { code: 'low_contrast', colors: ['#9a9a9a', '#ffffff'], ratio };
    expect([...packRefuses('faint-text', of('faint-text'), want), ...loadRefuses('faint-text', of('faint-text'), want)]).toEqual([]);
  });
  it(`AC3 ${AC3} the same text as #595959 loads (it does at the base too: the rule must not refuse ink that clears the floor)`, () => {
    expect(contrast('#595959', '#ffffff'), 'by the look\'s formula, #595959 on #ffffff clears the floor').toBeGreaterThanOrEqual(FLOOR);
    expect(loads('clear-text', of('clear-text'), 'Status')).toEqual([]);
  });
  it(`AC3 ${AC3} a panel that sets only text_color to #cccccc is refused at pack check and at load, naming the look's fill and the theme where it fails`, () => {
    // The other of the two is the shipped look's ground and raised, in light and dark; the worse pair decides.
    const failing = failingFills('#cccccc', shippedFills());
    expect(failing.length, 'by the look\'s formula, #cccccc is under the floor on a fill of the shipped look').toBeGreaterThan(0);
    const theme = failing[0]!.theme;
    const want = { code: 'low_contrast', theme, fills: failing.filter((pair) => pair.theme === theme).map(({ fill, color }) => ({ fill, color })) };
    expect([...packRefuses('text-color-only', of('text-color-only'), want), ...loadRefuses('text-color-only', of('text-color-only'), want)]).toEqual([]);
  });
});

describe(`AC4 ${AC4} reaches by key`, () => {
  it(`AC4 ${AC4} a div that takes a press and can't take focus is refused at pack check and at load with pointer_only, naming the node`, () => {
    const want = { code: 'pointer_only', node: NODE };
    expect([...packRefuses('pointer-only', of('pointer-only'), want), ...loadRefuses('pointer-only', of('pointer-only'), want)]).toEqual([]);
  });
  it(`AC4 ${AC4} with focus it loads (it does at the base too: the rule must not refuse a press that takes focus)`, () => {
    expect(loads('named-press', of('named-press'), 'Refresh')).toEqual([]);
  });
  it(`AC4 ${AC4} in a replica Tab reaches it, and Enter, then Space, each run its handler exactly once`, () => {
    expect(driveProblems('the replica', of('keys'))).toEqual([]);
  });
  it(`AC4 ${AC4} planted: a host that runs the handler on both key down and key up fails, naming the count`, () => {
    expect(driveProblems('the replica', of('keys')), 'the real host must pass the judge before its plant means anything').toEqual([]);
    const problems = driveProblems('the planted host', of('keys-planted'));
    expect(problems.filter((p) => p.startsWith('BLOCKED')), 'the planted host could be driven').toEqual([]);
    expect(problems, 'BLOCKED: the planted host ran the handler exactly once too, so it isn\'t one that runs it on both key down and key up').not.toEqual([]);
    expect(problems.join('\n'), 'the judge fails it naming the count').toContain('the planted host: Enter ran the handler 2 times, not exactly once');
  });
});

describe(`AC5 ${AC5} a panel installed against revision 1`, () => {
  const want = { code: 'no_name', node: NODE };
  it(`AC5 ${AC5} a panel installed against revision 1 that holds a nameless press still loads, and what panel@1 says of it for its listing names the finding`, () => {
    const installed = of('installed-at-1');
    expect([...stillLoads('installed-at-1', 'the loader', installed?.load), ...listingProblems('installed-at-1', installed, want)]).toEqual([]);
  });
  it(`AC5 ${AC5} planted: a host that refuses it at load fails, naming the panel`, () => {
    expect(stillLoads('installed-at-1', 'the loader', of('installed-at-1')?.load), 'the real loader must load it before its plant means anything').toEqual([]);
    const planted = of('installed-at-1-planted')?.load;
    const problems = stillLoads('installed-at-1', 'the planted host', planted);
    expect(problems.filter((p) => p.startsWith('BLOCKED')), 'the planted host ran').toEqual([]);
    expect(problems, 'BLOCKED: the planted host, which drops the record of the earlier install, loaded the panel too, so in this build no load holds a panel to revision 2').not.toEqual([]);
    expect(names(planted?.error ?? '', 'no_name'), `BLOCKED: the planted host refused it for another reason than the rule: ${planted?.error ?? ''}`).toBe(true);
    expect(problems.join('\n'), 'the judge fails it naming the panel').toContain('installed-at-1: the planted host refused at load a panel installed against revision 1');
  });
  it(`AC5 ${AC5} an update of that panel with the node unchanged is refused at pack check, naming the node and no_name`, () => {
    expect(packRefuses('update-of-installed', of('update-of-installed'), want)).toEqual([]);
  });
});
