// #1430's budgets, the `text-reflow` mode of benchmarks/canvas.mjs (task `canvas-text-reflow`), criterion 4: a release
// deep-text's `shape` lays a 50 KB text of 100 paragraphs out at 640 px, then five times with one more character typed
// into a paragraph, at the same width, then the last of them at five other widths, the text drawn whole
// (`overflow: mask`). Each reading is the shaper's time for its line (`shape`'s `ms`), and a run's is the median of its
// five: typed_char_50kb_ms and width_change_50kb_ms. One warm-up and five runs, each a fresh process.
const WORDS = ['amber', 'birch', 'cedar', 'delta', 'ember', 'fjord', 'grove', 'heron', 'inlet', 'juniper', 'kestrel', 'linden', 'meadow'];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
/** Paragraph k: 512 characters of words, by a stride of its own, so no two are equal. */
const paragraph = (k) => {
  let p = `p${k}`;
  for (let i = 0; p.length < 512; i++) p += ` ${WORDS[(i * (1 + (k % 11)) + k) % WORDS.length]}`;
  return p.slice(0, 512);
};

export function textReflow({ release, run, runs }) {
  const fingerprint = release('deep-text', 'deep-text');
  const paragraphs = Array.from({ length: 100 }, (_, k) => paragraph(k));
  const text = paragraphs.join('\n');
  const typed = [10, 30, 50, 70, 90].map((k) => {
    paragraphs[k] = `${paragraphs[k].slice(0, 256)}q${paragraphs[k].slice(256)}`;
    return paragraphs.join('\n');
  });
  const last = typed.at(-1);
  const line = (t, w) => JSON.stringify({ text: t, box: { w }, overflow: 'mask' });
  const lines = [line(text, 640), ...typed.map((t) => line(t, 640)), ...[600, 560, 520, 480, 440].map((w) => line(last, w))];
  const shown = [text, ...typed, ...typed.map(() => last)];
  const measured = runs(() => {
    const replies = run('deep-text', 'shape', lines, 'release');
    const wrong = replies.findIndex((r, i) => r.ok !== true || !Number.isFinite(r.ms) || r.shown !== shown[i]);
    if (wrong >= 0) throw Error(`deep-text shape answered line ${wrong + 1} with ${JSON.stringify(replies[wrong]).slice(0, 600)}`);
    const typing = replies.slice(1, 6).map((r) => r.ms);
    const widths = replies.slice(6).map((r) => r.ms);
    return { typed_char_50kb_ms: median(typing), width_change_50kb_ms: median(widths), typed_ms: typing, widths_ms: widths };
  });
  console.log(JSON.stringify({ task: 'canvas-text-reflow', fingerprint, bytes: text.length, runs: measured }));
}
