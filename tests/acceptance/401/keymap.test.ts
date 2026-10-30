// AC9: keymaps as data, scoped and checked at install. A binding to a send, a spend or answering an ask, or of the
// escape chord, is refused naming the chord; two plug-ins binding ⌘K in one context install with one conflict
// reported naming both; and with a focused panel that takes every key, the escape chord still reaches the shell.
// Through `deep-show run`'s `install`, `keymap` and `input` calls (README: The surface under test). At the base
// `deep-show` has no `install` call and answers every scenario `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  Driver, SEC, SLOTS, at, click, installCall, key, obj, plainTree, useOut, useShow, type JsonObject, type JsonValue, type Manifest, type Planted,
} from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 2 * SEC;
const HOME = { home: { panels: { h: { tree: plainTree('Home') } } } satisfies Manifest };

/** A plug-in with a harmless binding (⌘R to its change action) beside the one under test. */
function withBinding(chord: string, command: JsonObject, actions: Manifest['actions'] = {}): Manifest {
  return {
    panels: {}, actions: { refresh: { kind: 'change' }, ...actions },
    keymap: [{ chord: 'cmd+r', context: 'panel', command: { action: 'refresh' } }, { chord, context: 'panel', command }],
  };
}
const FORBIDDEN: { plugin: string; chord: string; manifest: Manifest; what: string }[] = [
  { plugin: 'sender', chord: 'cmd+enter', manifest: withBinding('cmd+enter', { core: 'session.send' }), what: 'a send into the session' },
  { plugin: 'mailer', chord: 'cmd+shift+p', manifest: withBinding('cmd+shift+p', { action: 'post' }, { post: { kind: 'send' } }), what: 'its send action' },
  { plugin: 'spender', chord: 'cmd+b', manifest: withBinding('cmd+b', { action: 'buy' }, { buy: { kind: 'spend' } }), what: 'its spend action' },
  { plugin: 'answerer', chord: 'cmd+y', manifest: withBinding('cmd+y', { core: 'ask.answer' }), what: 'answering the ask' },
  { plugin: 'escaper', chord: 'escape', manifest: withBinding('escape', { action: 'refresh' }), what: 'the escape chord' },
];

const bindingsOf = (reply: JsonObject | undefined): JsonObject[] => (Array.isArray(obj(reply, 'keymap')['bindings']) ? obj(reply, 'keymap')['bindings'] as JsonObject[] : []);
const conflictsOf = (reply: JsonObject | undefined): JsonObject[] => (Array.isArray(obj(reply, 'keymap')['conflicts']) ? obj(reply, 'keymap')['conflicts'] as JsonObject[] : []);

describe('AC9 a plug-in keymap that binds a chord to a send, a spend or an answer, or binds the escape chord, is refused at install naming the chord', () => {
  function refusals(planted?: Planted): string[] {
    const d = new Driver(show(), { evidence: out(), panels: {}, plugins: HOME, ...(planted ? { planted } : {}) });
    const r = d.step([...FORBIDDEN.map((x, i) => installCall(T0 + i * SEC, x.plugin, x.manifest)), at('keymap', T0 + 10 * SEC)], `the five keymaps${planted ? ` (planted ${planted})` : ''}`);
    const f: string[] = [];
    FORBIDDEN.forEach((x, i) => {
      const reply = obj(r[i], `install ${x.plugin}`);
      if (reply['installed'] === true || typeof reply['code'] !== 'string') f.push(`${x.plugin}'s binding of ${x.chord} to ${x.what} was not refused at install: ${JSON.stringify(reply)}`);
      else if (reply['chord'] !== x.chord) f.push(`${x.plugin}'s refusal names chord ${JSON.stringify(reply['chord'])}, not ${x.chord}`);
    });
    const left = bindingsOf(r[FORBIDDEN.length]).filter((b) => FORBIDDEN.some((x) => x.plugin === b['plugin']));
    if (left.length > 0) f.push(`the keymap holds bindings of refused plug-ins: ${JSON.stringify(left)}`);
    return f;
  }

  it('AC9 five plug-ins, each binding one forbidden chord beside a harmless ⌘R, are each refused naming that chord, and none of their bindings is in the keymap', () => {
    expect(refusals(), 'each refused, naming its chord').toEqual([]);
    // Wrong program: an install that takes any keymap as it is.
    const twin = refusals('keymap_unchecked');
    for (const x of FORBIDDEN) expect(twin.some((m) => m.startsWith(`${x.plugin}'s binding of ${x.chord}`)), `the planted keymap_unchecked fails, naming ${x.chord}: ${JSON.stringify(twin.slice(0, 5))}`).toBe(true);
  }, 600_000);
});

describe('AC9 two plug-ins binding ⌘K in one context install with one conflict reported naming both', () => {
  const palette = (chords: [string, string][]): Manifest => ({ panels: {}, actions: { open_palette: { kind: 'change' } }, keymap: chords.map(([chord, context]) => ({ chord, context, command: { action: 'open_palette' } })) });

  function conflicts(planted?: Planted): string[] {
    const d = new Driver(show(), { evidence: out(), panels: {}, plugins: HOME, ...(planted ? { planted } : {}) });
    const r = d.step([
      installCall(T0, 'palette-a', palette([['cmd+k', 'panel'], ['cmd+j', 'panel']])),
      installCall(T0 + SEC, 'palette-b', palette([['cmd+k', 'panel']])),
      // ⌘K in another context is no conflict with the two.
      installCall(T0 + 2 * SEC, 'palette-c', palette([['cmd+k', 'sheet']])),
      at('keymap', T0 + 3 * SEC),
    ], `two palettes${planted ? ` (planted ${planted})` : ''}`);
    const f: string[] = [];
    ['palette-a', 'palette-b', 'palette-c'].forEach((p, i) => { if (obj(r[i], `install ${p}`)['installed'] !== true) f.push(`${p} did not install: ${JSON.stringify(r[i])}`); });
    const list = conflictsOf(r[3]);
    if (list.length !== 1) f.push(`the keymap reports ${list.length} conflicts, not one: ${JSON.stringify(list)}`);
    const c = list[0];
    if (c) {
      const plugins = (Array.isArray(c['plugins']) ? (c['plugins'] as JsonValue[]) : []).map(String).sort();
      if (c['chord'] !== 'cmd+k' || c['context'] !== 'panel' || JSON.stringify(plugins) !== JSON.stringify(['palette-a', 'palette-b'])) f.push(`the conflict is ${JSON.stringify(c)}, not cmd+k in panel naming palette-a and palette-b`);
    }
    return f;
  }

  it('AC9 palette-a and palette-b both bind ⌘K in the panel context: both install, and the keymap reports exactly that one conflict', () => {
    expect(conflicts(), 'one conflict naming both').toEqual([]);
    // Wrong program: a keymap that installs both and reports nothing.
    const twin = conflicts('conflicts_unreported');
    expect(twin.some((m) => m.startsWith('the keymap reports 0 conflicts')), `the planted conflicts_unreported fails: ${JSON.stringify(twin)}`).toBe(true);
  }, 600_000);
});

describe('AC9 with a focused panel that handles that key, the escape chord still reaches the shell', () => {
  function escape(planted?: Planted): string[] {
    const d = new Driver(show(), {
      evidence: out(), panels: { t: SLOTS[0]! }, ...(planted ? { planted } : {}),
      plugins: { term: { panels: { t: { tree: plainTree('Terminal'), raw_input: true } } } },
    });
    const r = d.step([...click(T0, 't', SLOTS[0]!), at('focus', T0 + SEC), key(T0 + 2 * SEC, 't', 'k'), key(T0 + 3 * SEC, 't', 'Escape')], `the focused terminal panel${planted ? ` (planted ${planted})` : ''}`);
    const f: string[] = [];
    if (obj(r[2], 'focus')['kb_focus'] !== 't') f.push(`keyboard focus is ${JSON.stringify(obj(r[2], 'focus')['kb_focus'])} after your click in t, not t`);
    const reached = (reply: JsonObject | undefined, what: string): string[] => {
      const v = obj(reply, what)['reached'];
      return Array.isArray(v) ? v.map(String) : (f.push(`${what}: no reached list: ${JSON.stringify(reply)}`), []);
    };
    // The control: the focused panel does take keys (raw input).
    if (!reached(r[3], 'the key k').includes('panel:t')) f.push('the key k did not reach the focused panel t, so it doesn\'t handle keys');
    const esc = reached(r[4], 'the escape chord');
    if (!esc.includes('shell')) f.push(`the escape chord reached ${JSON.stringify(esc)}, not the shell, with t focused`);
    return f;
  }

  it('AC9 a panel taking raw input, focused by your click, gets the key k, and the escape chord reaches the shell', () => {
    expect(escape(), 'escape reaches the shell').toEqual([]);
    // Wrong program: a router that hands every key, the escape chord too, to the focused panel alone.
    const twin = escape('focused_panel_takes_escape');
    expect(twin.some((m) => m.startsWith('the escape chord reached')), `the planted focused_panel_takes_escape fails: ${JSON.stringify(twin)}`).toBe(true);
  }, 600_000);
});
