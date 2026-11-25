// #3222's 16-session script (criterion 3), as the lines its hub sends a canvas side (README: The 16-session script).
//
// The script is the one `docs/spikes/3222/harness.mjs` runs without `--patches`, written out here from that file at the
// base (a harness is a command, not a module: it can't be imported): each session's two setup calls, then its rounds of
// six calls in a rotation that starts at its own place, with the harness's documents, sizes, values and seeded gaps.
// The hub's part is written out from packages/hub/src: the world `shape` builds from the harness's own world file
// (canvas.ts), and each call as `showCall` and `HubCanvas.show` send it (canvas.ts, hub-canvas.ts).
//
// Two things are this suite's, because a script has no order across sessions and its sessions never end:
// - the order: the harness's sessions run side by side, and here a call goes when its session's seeded gaps say it
//   would if no call took any time, a session's n-th call before another's n+1-th at the same time;
// - the end: a session ends once it has made its last call, as its SessionEnd hook would end it. The hub then sends
//   its world without that session, and the document's revisions are read (the hub's `revisions` read).
import { createHash } from 'node:crypto';

const docId = (n) => `01JC32${String(n).padStart(20, '0')}`;
const sessionId = (i) => {
  const h = createHash('sha256').update(`ds3222:session-${i}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const d2Of = (i) => docId(2 * i + 1);
const d3Of = (i) => docId(2 * i + 2);

// ---- The documents (harness.mjs `figure`, `box3d`).
const rect = (id, name, box, order, role = 'muted') => ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role } } } });
const label = (id, name, text, pos, order) => ({ id, kind: 'text@1', name, order, params: { text, font: 'body', size: 13, box: { w: 160, h: 20 } }, at: { pos: [pos[0], pos[1], 0] } });
const SIZE_2D = [320, 200];
const SIZE_3D = [320, 240];
const figure = (w) => ({
  format: 1, profile: 'board', title: 'Release readiness', description: 'Release readiness, drawn by a #3222 scripted session through deep_show.', size: SIZE_2D,
  items: Object.fromEntries([
    rect('back', 'Backdrop', [0, 0, 320, 200], 'a0', 'ground'),
    rect('bar-build', 'Build bar', [16, 60, w, 16], 'a1'),
    rect('bar-tests', 'Tests bar', [16, 90, 180, 16], 'a2'),
    rect('bar-docs', 'Docs bar', [16, 120, 120, 16], 'a3'),
    label('title', 'Title', 'Release readiness', [16, 20], 'a4'),
    label('caption', 'Caption', 'Ready for review', [16, 160], 'a5'),
  ].map((i) => [i.id, i])),
});
const box3d = (x) => ({
  format: 1, profile: 'scene', title: 'A box under a badge', description: 'A #3222 scripted session\'s 3D document: one box with a 2D badge over it.',
  size: SIZE_3D, camera: 'cam', transport: { span: '1s' }, requires: { modules: { scene3d: '^1' } },
  items: {
    cam: { id: 'cam', name: 'cam', order: 'a0', kind: 'camera@1', params: { projection: 'perspective', position: [0, 0, 8], target: [0, 0, 0], fov: 40 } },
    box: { id: 'box', name: 'box', order: 'a1', kind: 'mark.box@1', params: { size: [2, 2, 2], paint: { fill: { role: 'accent' } } }, at: { pos: [x, 0, 0] } },
    badge: { id: 'badge', name: 'badge', order: 'a2', kind: 'rect@1', params: { box: [40, 30, 100, 60], paint: { fill: { role: 'ink' } } } },
  },
});

/** The rotation each session's rounds start at its own place in (harness.mjs `ROTATION`). */
const ROTATION = [['2d', 'patch'], ['2d', 'check'], ['2d', 'render_back_2d'], ['3d', 'revision'], ['3d', 'render_back_3d'], ['2d', 'revision']];

/** The world the hub sends for the harness's world file: every session live but those `ended`, each 2D document seeded with an empty board. */
function worldOf(n, ended) {
  const sessions = {}, docs = {};
  for (let i = 0; i < n; i++) {
    if (!ended.has(i)) sessions[sessionId(i)] = { thread: sessionId(i), name: `Scripted session ${i}`, process: { pid: 0, start: 0 } };
    docs[d2Of(i)] = { panel: 'main', document: { ...figure(240), items: {} } };
    docs[d3Of(i)] = { panel: 'main' };
  }
  return { sessions, record: {}, panels: { main: { rect: [0, 0, 800, 600] } }, docs, packs: [] };
}

/** Each session's calls in the script's order: `{ i, k, at, dim, kind, value }`, `at` the ms its seeded gaps add up to. */
function order(n) {
  const rounds = Math.max(2, Math.ceil(20 / n));
  const all = [];
  for (let i = 0; i < n; i++) {
    all.push({ i, k: 0, at: 0, dim: '2d', kind: 'revision', value: 240 }, { i, k: 1, at: 0, dim: '3d', kind: 'revision', value: 0 });
    let seed = i * 7919 + 1, at = 0, k = 2;
    const gap = () => { seed = (seed * 48271) % 2147483647; return seed % 251; };
    for (let r = 0; r < rounds; r++) {
      for (let j = 0; j < ROTATION.length; j++) {
        const [dim, kind] = ROTATION[(j + i) % ROTATION.length];
        const w = 100 + ((r * 6 + j + i) % 140);
        at += gap();
        all.push({ i, k: k++, at, dim, kind, value: dim === '2d' ? w : (w % 30) / 10 - 1.5 });
      }
    }
  }
  return all.sort((a, b) => a.at - b.at || a.k - b.k || a.i - b.i);
}

/**
 * Plays the script of `n` sessions through `send` (side.mjs `compare`'s): the world, then every call, each as the hub
 * sends it and with the revision its session last got back, as the harness's sessions take theirs from their replies.
 * Returns the count of each kind of call sent, and the sessions that ended.
 */
export async function playScript(n, send) {
  const calls = order(n);
  const last = new Map(calls.map((c) => [c.i, c.k]));
  const rev = new Map();
  const ended = new Set();
  const sent = {};
  let patches = 0;
  await send({ world: worldOf(n, ended) });
  for (const c of calls) {
    const session = sessionId(c.i);
    const doc = c.dim === '2d' ? d2Of(c.i) : d3Of(c.i);
    const size = c.dim === '2d' ? SIZE_2D : SIZE_3D;
    const show = (fields) => ({ call: 'deep_show', session, doc, t: '0s', size, ...fields });
    let call;
    if (c.kind === 'revision') call = show({ include: ['issues', 'pixels'], document: c.dim === '2d' ? figure(c.value) : box3d(c.value) });
    else if (c.kind === 'check') call = show({ include: ['issues'], check: true, document: figure(c.value) });
    else if (c.kind === 'patch') {
      const patch = { patch: `01JC32P${String(++patches).padStart(19, '0')}`, doc, base: rev.get(doc) ?? 1, reason: 'a #3222 scripted patch of one value', ops: [{ op: 'set', id: 'bar-build', path: 'items/bar-build/params/box', value: [16, 60, c.value, 16] }] };
      call = show({ include: ['issues'], patch });
    } else call = { call: 'render_back', doc, t: 0, rev: rev.get(doc) ?? 1, size, session };
    const answer = await send({ call });
    const reply = answer?.reply ?? {};
    if (typeof reply.rev === 'number' && reply.outcome !== 'refused') rev.set(doc, reply.rev);
    sent[c.kind] = (sent[c.kind] ?? 0) + 1;
    if (last.get(c.i) === c.k) {
      ended.add(c.i);
      await send({ world: worldOf(n, ended) });
      await send({ call: { call: 'revisions', doc: d2Of(c.i) } });
    }
  }
  return { sent, ended: ended.size };
}
