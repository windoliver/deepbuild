// AC5: "The replica's accessibility tree holds one node per part and control with its name and role, and the readout's
// change emits exactly one announcement, '4'. Popped out to the second display, the view reopens there and presents at
// that display's rate, and the question card opens on the display you're using"
//
// asserts: on the hub's virtual display clock with two displays (#400's A at 120 Hz, the main window's, and B at
// 60 Hz), the agent shows the piece at the clock's start, so the piece's time is the clock's. You click the view and
// pop it out onto B at 0.4 s: `windows` lists a popped window on B showing the view, and the view's presented frames
// between 0.5 s and 1.5 s (the piece moving throughout) are all paced by B, each at one of B's vsyncs, 60 of them. You
// then click the popped-out view at 2.2 s, an ask arrives at 2.6 s, and its question card opens on B, the display of
// your latest input. `see` at 6.5 s (#376) holds exactly one node for each item whose role is `part` and for the
// control, with the document's name (a control's label) and role, and exactly one announcement in the whole run: the
// readout `readout`, at or after 2 s, its text holding '4' and not '3'.
// Wrong programs: a tree that leaves out or doubles a part or control, or loses a name or role; a readout announced on
// every frame or never; a pop-out that leaves the view on the main display, or paces it by the main display's clock;
// a card on the main window's display.
import { describe, expect, it } from 'vitest';
import {
  A, B, Driver, PANEL, arr, card, clickPanel, framesOf, itemsOf, keepProof, num, obj, onGrid, periodOf, piece, popOut, sec, shown, str,
  useBuilds, useDir, windowsOf,
} from './helpers.ts';

const builds = useBuilds(['deep-show']);
const dir = useDir();
const CARD_AT = sec(2.6);

describe('AC5 the piece in the app: its accessibility tree, a view popped out to another display, and the card', () => {
  it('AC5 one node per part and control with its name and role, exactly one announcement \'4\', the view popped out to B presents at B\'s rate, and the card opens on the display you\'re using', () => {
    const d = new Driver(builds.bin('deep-show'), { evidence: dir(), card: card(CARD_AT) });
    const serial = clickPanel(d, sec(0.2), 'AC5 the first click');
    const popped = d.one(popOut(sec(0.4), B.uuid, serial), 'AC5 pop out onto B');
    expect(popped['code'], `AC5: the pop-out opens a window: ${shown(popped)}`).toBeUndefined();
    const wins = windowsOf(d.one({ call: 'windows', at: sec(0.45) }, 'AC5 windows'), 'AC5 windows');
    const view = wins.find((w) => w.view === PANEL && w.kind !== 'main');
    expect(view, `AC5: the view reopens in a window of its own: ${JSON.stringify(wins)}`).toBeDefined();
    expect(view!.display, 'AC5: the view reopens on the second display').toBe(B.uuid);
    clickPanel(d, sec(2.2), 'AC5 a click in the popped-out view');
    const [c, presented, see] = d.step([{ call: 'card', at: CARD_AT + sec(0.4) }, { call: 'presented', at: sec(6.5), panel: PANEL }, { call: 'see', at: sec(6.5), panel: PANEL }], 'AC5 the card, the frames and the tree');
    keepProof('ac5-presented.json', presented!);
    keepProof('ac5-see.json', see!);
    keepProof('ac5-card.json', c!);
    // The card on the display you're using.
    const cardState = obj(obj(c, 'AC5 card')['card'], `AC5: the question card is presented (${shown(c)})`);
    expect(cardState['display'], 'AC5: the question card opens on B, the display of your latest input').toBe(B.uuid);
    // The popped-out view presents at B's rate.
    const frames = framesOf(presented, 'AC5 presented');
    const span = frames.filter((f) => f.vsync >= sec(0.5) && f.vsync < sec(1.5));
    const off = span.filter((f) => f.display !== B.uuid || !onGrid(B, f.vsync));
    expect(off.map((f) => `${f.vsync} on ${f.display}`), 'AC5: every frame of the popped-out view is paced by B, at one of its vsyncs').toEqual([]);
    expect(span.length, `AC5: the popped-out view presents ${sec(1) / periodOf(B)} frames in 1 s while the piece moves, B's rate (A's would be ${sec(1) / periodOf(A)})`).toBe(sec(1) / periodOf(B));
    // The accessibility tree, read as data.
    const tree = arr(obj(see, 'AC5 see')['tree'], `AC5 see: tree (${shown(see)})`).map((n, i) => obj(n, `tree[${i}]`));
    const p = piece();
    const expected = [
      ...Object.entries(itemsOf(p)).filter(([, it]) => it['role'] === 'part').map(([id, it]) => ({ id, name: str(it['name'], 'name'), role: 'part' })),
      ...Object.entries(obj(p['controls'], 'controls')).map(([id, c0]) => ({ id, name: str(obj(c0, id)['label'], 'label'), role: str(obj(c0, id)['role'], 'role') })),
    ];
    const treeFailures: string[] = [];
    for (const e of expected) {
      const nodes = tree.filter((n) => n['id'] === e.id);
      if (nodes.length !== 1) treeFailures.push(`${e.id}: ${nodes.length} nodes, not one`);
      else if (nodes[0]!['name'] !== e.name || nodes[0]!['role'] !== e.role) treeFailures.push(`${e.id}: node ${shown(nodes[0])}, not name ${e.name} and role ${e.role}`);
    }
    expect(treeFailures, 'AC5: one node per part and control with its name and role').toEqual([]);
    // The readout's change: exactly one announcement, '4'.
    const said = arr(obj(see, 'AC5 see')['announcements'], 'AC5 see: announcements').map((a, i) => obj(a, `announcements[${i}]`));
    expect(said.length, `AC5: the readout's change from 3 to 4 emits exactly one announcement: ${shown(said)}`).toBe(1);
    const a = said[0]!;
    expect(a['id'], 'AC5: the announcement is the readout\'s').toBe('readout');
    expect(num(a['t'], 'announcement.t'), 'AC5: announced once the readout changed, at 2 s').toBeGreaterThanOrEqual(sec(2));
    const text = str(a['text'], 'announcement.text');
    expect(text.includes('4') && !text.includes('3'), `AC5: the announcement says '4': ${shown(a)}`).toBe(true);
  }, 1_800_000);
});
