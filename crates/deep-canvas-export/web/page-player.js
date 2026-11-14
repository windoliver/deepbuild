// DeepBuild's playable page player (#169; canvas primitives: Export: playable page). The same
// bytes in every export: it reads the manifest the index page carries as text, shows each
// state's still (or its loop), and when a target, a control or a key changes one control it plays
// that edge's clip and lands on the next state. It loads only the page's own files and runs no
// code from the document: every text from the document is set as text, never as markup.
//
// What a browser reads: <html data-deep-state> names the state shown, and data-deep-edge is on
// <html> while an edge plays. Each node of the state's accessibility tree is one element marked
// data-deep-id, in the tree's order: the document, its parts, each control and, after it, each of
// its targets, a button over its box marked data-deep-target, reached by Tab and pressed by Enter.
(() => {
  'use strict';
  const manifest = JSON.parse(document.getElementById('deep-manifest').content.textContent);
  const html = document.documentElement;
  const root = document.getElementById('page');
  const el = (tag, attrs = {}, text) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, String(v));
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const states = new Map(manifest.states.map((s) => [s.id, s]));
  const edges = new Map(manifest.edges.map((e) => [e.id, e]));
  const axes = new Map(manifest.controls.map((c) => [c.id, c]));
  const controlIds = new Set(manifest.control_ids);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const doc = el('section', { class: 'doc' });
  const frame = el('div', { class: 'frame' });
  const still = el('img', { class: 'still', alt: '', draggable: 'false' });
  const clip = el('video', { class: 'clip', playsinline: '', preload: 'auto', hidden: '' });
  frame.append(still, clip);
  const sliders = el('div', { class: 'sliders' });
  const bound = el('ul', { class: 'bound' });
  const live = el('div', { class: 'announce', 'aria-live': 'polite', role: 'status' });
  root.append(doc, sliders, bound, live);

  let current = manifest.start;
  let busy = false;
  // The one sampled control and the turntable: each still is one slider moved from its first
  // value, and the last slider moved picks the still.
  let sampled = 0;
  let turned = 0;
  let moved = null;
  const stillOf = (s) => (moved === 'sample' && s.samples.length ? s.samples[sampled].still : moved === 'orbit' && s.orbit.length ? s.orbit[turned].still : s.still);
  const edgesOf = (s) => s.edges.map((id) => edges.get(id));
  // Every state's still decoded up front, so a landing never waits on one.
  const decoded = new Map();
  const ready = (src) => {
    if (!decoded.has(src)) {
      const image = new Image();
      image.src = src;
      decoded.set(src, image.decode().catch(() => undefined));
    }
    return decoded.get(src);
  };
  manifest.states.forEach((s) => ready(s.still));
  const edgeTo = (s, control, value) => edgesOf(s).find((e) => e.control === control && same(e.value, value)) || null;

  // A control: its own widget, by its role, where the page lists it; the sampled slider; any
  // other a node with its role and name.
  function widget(node, s) {
    if (manifest.sample && manifest.sample.control === node.id) {
      const input = el('input', { type: 'range', min: 0, max: manifest.sample.values.length - 1, step: 1, value: sampled, role: node.role || null, 'aria-label': node.name, 'data-deep-id': node.id });
      input.addEventListener('input', () => { sampled = Number(input.value); moved = 'sample'; still.src = stillOf(states.get(current)); });
      return input;
    }
    const c = axes.get(node.id);
    if (!c) return el('div', { class: 'control', role: node.role || null, 'aria-label': node.name, 'data-deep-id': node.id }, node.name);
    const value = s.controls[c.id];
    if (c.kind === 'toggle') {
      const on = value === true;
      const checked = node.role === 'switch' || node.role === 'checkbox';
      const b = el('button', { type: 'button', class: 'control', role: node.role || null, 'aria-label': node.name, 'data-deep-id': node.id, 'data-control': c.id, 'aria-checked': checked ? String(on) : null, 'aria-pressed': checked ? null : String(on) }, node.name);
      b.addEventListener('click', () => play(edgeTo(s, c.id, !on)));
      return b;
    }
    const group = el('div', { class: 'control', role: node.role || 'group', 'aria-label': node.name, 'data-deep-id': node.id });
    const each = node.role === 'radiogroup' ? 'radio' : node.role === 'tablist' ? 'tab' : null;
    for (const o of c.options) {
      const on = same(value, o.value);
      const state = each === 'radio' ? { 'aria-checked': String(on) } : each === 'tab' ? { 'aria-selected': String(on) } : { 'aria-pressed': String(on) };
      const b = el('button', { type: 'button', role: each, 'data-control': c.id, 'data-option': o.name, ...state }, o.label);
      b.addEventListener('click', () => play(edgeTo(s, c.id, o.value)));
      group.append(b);
    }
    return group;
  }

  // A target: a button over its box (left and size in the still's width, top as a margin, which
  // resolves against the width too), its edge played by a click or by Enter.
  function target(node, s) {
    const t = s.targets.find((x) => x.target === node.id);
    const b = el('button', { type: 'button', class: 'target', 'aria-label': node.name, title: node.name, 'data-deep-id': node.id, 'data-deep-target': node.id, 'data-control': t ? t.control : null, 'data-option': t ? t.option : null });
    if (t) {
      const [x, y, bw, bh] = t.box;
      const w = s.size[0];
      Object.assign(b.style, { left: `${(100 * x) / w}%`, marginTop: `${(100 * y) / w}%`, width: `${(100 * bw) / w}%`, aspectRatio: `${bw} / ${Math.max(bh, 1)}` });
    }
    const edge = t && t.edge ? edges.get(t.edge) : null;
    b.addEventListener('click', () => play(edge));
    return b;
  }

  // Planted (#169 AC7's wrong page): targets only as boxes on the still, a click in one plays it.
  frame.addEventListener('click', (event) => {
    if (!manifest.targets_on_image) return;
    const s = states.get(current);
    const r = frame.getBoundingClientRect();
    const [px, py] = [((event.clientX - r.left) * s.size[0]) / r.width, ((event.clientY - r.top) * s.size[1]) / r.height];
    const t = s.targets.find(({ box: [x, y, bw, bh] }) => px >= x && px < x + bw && py >= y && py < y + bh);
    if (t && t.edge) play(edges.get(t.edge));
  });
  function boxes(s) {
    const [w, h] = s.size;
    for (const { box: [x, y, bw, bh] } of s.targets) {
      const box = el('div', { class: 'box' });
      Object.assign(box.style, { left: `${(100 * x) / w}%`, top: `${(100 * y) / h}%`, width: `${(100 * bw) / w}%`, height: `${(100 * bh) / h}%` });
      frame.append(box);
    }
  }

  function show(id) {
    const s = states.get(id);
    current = id;
    html.setAttribute('data-deep-state', id);
    const active = document.activeElement;
    const focus = active && active !== document.body ? active.getAttribute('data-deep-id') || `${active.getAttribute('data-control')}/${active.getAttribute('data-option')}` : null;
    still.src = stillOf(s);
    if (s.loop) {
      Object.assign(clip, { loop: true, muted: true, hidden: false, src: s.loop });
      clip.play().catch(() => { clip.hidden = true; });
    } else {
      Object.assign(clip, { loop: false, hidden: true });
      clip.removeAttribute('src');
    }
    doc.replaceChildren(frame);
    frame.querySelectorAll('.box').forEach((b) => b.remove());
    if (manifest.targets_on_image) boxes(s);
    for (const node of s.tree) {
      if (node.role === 'document') {
        doc.setAttribute('role', 'document');
        doc.setAttribute('aria-label', node.name);
        doc.setAttribute('data-deep-id', node.id);
        if (node.description) doc.setAttribute('aria-description', node.description);
      } else if (node.item !== undefined && node.role === 'button') {
        if (!manifest.targets_on_image) doc.append(target(node, s));
      } else if (controlIds.has(node.id)) {
        doc.append(widget(node, s));
      } else {
        doc.append(el('div', { class: 'node', role: 'img', 'aria-roledescription': node.role, 'aria-label': node.name, 'data-deep-id': node.id }));
      }
    }
    const advance = edgesOf(s).find((e) => e.control === 'present');
    if (advance) {
      const b = el('button', { type: 'button', class: 'control', 'aria-keyshortcuts': 'ArrowRight' }, 'Next');
      b.addEventListener('click', () => play(advance));
      doc.append(b);
    }
    if (focus) {
      const again = [...doc.querySelectorAll('[data-deep-id], [data-option]')].find((e) => e.getAttribute('data-deep-id') === focus || `${e.getAttribute('data-control')}/${e.getAttribute('data-option')}` === focus);
      if (again) again.focus({ preventScroll: true });
    }
  }

  // A changed readout is announced when the edge lands, once.
  function announce(from, to) {
    const said = Object.entries(to.readouts || {}).filter(([id, text]) => (from.readouts || {})[id] !== text).map(([, text]) => text);
    if (said.length) live.textContent = said.join('. ');
  }

  // The clip's last frame stays on screen until the next state's still has decoded in its place,
  // so a landing never shows the state it left.
  async function land(edge) {
    const to = states.get(edge.to);
    await ready(stillOf(to));
    still.src = stillOf(to);
    await still.decode().catch(() => undefined);
    show(edge.to);
    html.removeAttribute('data-deep-edge');
    announce(states.get(edge.from), to);
    busy = false;
  }

  // An edge plays its clip, with its sound, and lands; one that takes no time lands at once. A
  // value the state already holds has no edge, so nothing plays.
  function play(edge) {
    if (busy || !edge || edge.from !== current) return;
    busy = true;
    html.setAttribute('data-deep-edge', edge.id);
    if (!edge.clip) return land(edge);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clip.onended = clip.onerror = null;
      land(edge);
    };
    const timer = setTimeout(finish, 1000 * (edge.span || 0) + 4000);
    clip.onended = finish;
    clip.onerror = finish;
    Object.assign(clip, { loop: false, muted: false, hidden: false, src: edge.clip });
    clip.play().catch(() => { clip.muted = true; clip.play().catch(finish); });
  }

  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    // Enter and Space on a focused button press that button.
    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && event.target.closest('button, input')) return;
    const edge = edgesOf(states.get(current)).find((e) => e.keys.includes(event.key));
    if (!edge) return;
    event.preventDefault();
    play(edge);
  });

  if (manifest.orbit) {
    const input = el('input', { type: 'range', min: 0, max: manifest.orbit.frames - 1, step: 1, value: 0, 'aria-label': 'Turn' });
    input.addEventListener('input', () => { turned = Number(input.value); moved = 'orbit'; still.src = stillOf(states.get(current)); });
    sliders.append(input);
  }
  // Each bound value as the text it shows, with its as-of time.
  for (const b of manifest.bound) {
    const item = el('li', { 'data-deep-bound': b.id }, `${b.text ?? ''} `);
    if (b.as_of === null || b.as_of === undefined) item.append(el('span', {}, 'as of an unknown time'));
    else {
      const at = new Date(b.as_of).toISOString();
      item.append(el('time', { datetime: at }, `as of ${at.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`));
    }
    bound.append(item);
  }
  show(current);
})();
