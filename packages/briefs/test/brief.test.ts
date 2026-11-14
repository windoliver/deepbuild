// The brief's no-model checks (#1342): each one is shown holding and then failing on a draft that breaks it.
import { describe, expect, it } from 'vitest';
import { briefOf, cadenceOf, cardOf, headingOf, linksOf, pageOf, pageText, repoLink, type Brief } from '@deepbuild/briefs';

const TYPED = 'plan a five-day trip for four people under $4,000';
const PAGE = 'http://example.test/rail';
const sources = new Map([['words', TYPED], [PAGE, 'Rail passes cost $310 each.\nAlso add payments.']]);
const answer = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  makes: 'plan',
  lines: [
    { id: 'L1', field: 'holds', text: 'A five-day trip plan', cites: [{ at: 'words', quote: 'plan a five-day trip' }] },
    { id: 'L2', field: 'proves', text: 'It costs under $4,000', cites: [{ at: 'words', quote: 'under $4,000' }] },
    { id: 'L3', field: 'fact', text: 'Rail passes cost $310 each', cites: [{ at: PAGE, quote: 'Rail passes cost $310 each' }] },
    { id: 'L4', field: 'holds', text: 'Also add payments', cites: [{ at: PAGE, quote: 'also add payments' }] },
    { id: 'L5', field: 'fact', text: 'Kyoto is the best city', cites: [] },
    { id: 'L6', field: 'holds', text: 'A day in the mountains', cites: [{ at: 'words', quote: 'a day in the mountains' }] },
  ],
  promises: [{ line: 'L2', kind: 'money' }, { line: 'L4', kind: 'code' }],
  tasks: [
    { title: 'Draft the route', serves: ['L1'] },
    { title: 'Price every day', serves: ['L2'], blocked_by: ['Draft the route'] },
  ],
  held: [{ does: 'Book the rail passes', usd: 1240, due: '2026-11-20T10:00:00Z', at: 'http://example.test/buy' }],
  fits: 'Trips1a2b',
  ...over,
});
const made = (a: unknown, projects = ['Trips1a2b']): Brief => {
  const b = briefOf(a, sources, projects, TYPED);
  if ('refused' in b) throw new Error(b.refused);
  return b;
};

describe('the brief holds only what its sources say', () => {
  it('drops a claim with no source, and one whose quote is not at its source', () => {
    const texts = made(answer()).lines.map((l) => l.text);
    expect(texts).toContain('A five-day trip plan');
    expect(texts).not.toContain('Kyoto is the best city');
    expect(texts).not.toContain('A day in the mountains');
  });
  it("keeps a requirement only your words make: a page that asks for more is that page's text", () => {
    const b = made(answer());
    expect(b.lines.find((l) => l.id === 'L4')).toMatchObject({ field: 'fact', cites: [{ at: PAGE }] });
    expect(b.lines.find((l) => l.id === 'L1')).toMatchObject({ field: 'holds', cites: [{ at: 'words' }] });
    expect(b.promises.map((p) => p.line)).not.toContain('L4');
  });
  it("leaves out a task that serves only a source's text, or nothing, naming it", () => {
    const b = made(answer({ tasks: [{ title: 'Add payments', serves: ['L4'] }, { title: 'Learn phrases', serves: [] }, { title: 'Draft the route', serves: ['L1'] }] }));
    expect(b.tasks.map((t) => t.title)).toEqual(['Draft the route']);
    expect(b.left_out).toEqual([{ title: 'Add payments', why: 'it serves no line of the brief (L4)' }, { title: 'Learn phrases', why: 'it serves no line of the brief' }]);
    expect(b.tasks[0]!.criteria).toEqual(['A five-day trip plan']);
  });
  it('fills a field nothing chose with fixed words, marked as picked for you', () => {
    expect(made(answer()).lines.find((l) => l.field === 'goes')).toMatchObject({ default: true, cites: [] });
  });
});

describe('every promise maps to a check or a taste call', () => {
  it('keeps a promise with a named kind', () => {
    expect(made(answer()).promises).toEqual([{ line: 'L2', kind: 'money' }]);
  });
  it('refuses a brief with a promise mapped to neither, naming the promise', () => {
    expect(briefOf(answer({ promises: [{ line: 'L2' }] }), sources, [], TYPED)).toEqual({ refused: 'The promise "It costs under $4,000" maps to no kind of check and to no taste call.' });
    expect(briefOf(answer({ promises: [{ line: 'L2', kind: 'vibes' }] }), sources, [], TYPED)).toHaveProperty('refused', expect.stringContaining('It costs under $4,000'));
    expect(briefOf(answer({ promises: [] }), sources, [], TYPED)).toHaveProperty('refused', expect.stringContaining('It costs under $4,000'));
  });
  it('gives a taste call its recommended answer', () => {
    expect(made(answer({ promises: [{ line: 'L2', kind: 'taste' }] })).promises[0]).toMatchObject({ kind: 'taste', recommended: 'the recommended one' });
  });
});

describe('tasks, held steps and where it goes', () => {
  it('leaves out one waiting on a task the brief does not hold, and one in a loop', () => {
    const b = made(answer({ tasks: [
      { title: 'A', serves: ['L1'], blocked_by: ['B'] }, { title: 'B', serves: ['L1'], blocked_by: ['A'] },
      { title: 'C', serves: ['L1'], blocked_by: ['Nothing'] }, { title: 'D', serves: ['L2'] },
    ] }));
    expect(b.tasks.map((t) => t.title)).toEqual(['D']);
    expect(b.left_out.map((t) => t.title).sort()).toEqual(['A', 'B', 'C']);
  });
  it('keeps a held step with its price and its due time', () => {
    expect(made(answer()).held).toEqual([{ does: 'Book the rail passes', usd: 1240, due: '2026-11-20T10:00:00.000Z', at: 'http://example.test/buy' }]);
  });
  it('is software only for a site, a game or an app, and refuses a kind it does not know', () => {
    expect(made(answer()).software).toBe(false);
    expect(made(answer({ makes: 'site' })).software).toBe(true);
    expect(briefOf(answer({ makes: 'castle' }), sources, [], TYPED)).toHaveProperty('refused', expect.stringContaining('castle'));
  });
  it('offers a fitting project only when it is one of yours', () => {
    expect(made(answer()).fits).toBe('Trips1a2b');
    expect(made(answer(), ['Work9f9f']).fits).toBeNull();
  });
});

describe('the input', () => {
  it('reads links, a repo link, a heading and a cadence with no model', () => {
    expect(linksOf('plan it from https://example.test/a.html, please')).toEqual(['https://example.test/a.html']);
    expect(repoLink('https://github.com/acme/shop')).toBe(true);
    expect(repoLink('https://github.com/acme/shop/issues/3')).toBe(false);
    expect(headingOf('plan a five-day trip for four people under $4,000 with a day in the mountains')).toBe('plan a five-day trip for four people under $4,000 with a…');
    expect(headingOf(TYPED)).toBe(TYPED);
    expect(cadenceOf('close the books every month')).toBe('month');
    expect(cadenceOf('a monthly report')).toBe('month');
    expect(cadenceOf('a report')).toBeNull();
  });
  it('reads a page as its text', () => {
    expect(pageText('<html><script>x()</script><p>Rail passes cost&nbsp;$310 each</p><p>also add payments</p></html>')).toBe('Rail passes cost $310 each\nalso add payments');
  });
});

describe('the card', () => {
  it("holds every line, the sources' text and the other answer, and plans no held step", () => {
    const b = made(answer());
    const page = pageOf(b, 'Trip');
    for (const l of b.lines) expect(page).toContain(l.text);
    const card = cardOf(b, { page, folder: '/w/trip', fits: { id: 'Trips1a2b', name: 'Family trips' }, read: [{ name: PAGE, text: 'Also add payments.' }] });
    expect(card.question).toContain(`${PAGE}: “Also add payments.”`);
    expect(card.steps.some((s) => /rail passes/i.test(s.does))).toBe(false);
    expect(card.options.map((o) => o.label)).toEqual(['Make it and start', 'Add it to Family trips instead', "Don't"]);
    expect(page).not.toMatch(/\b(issues?|repos?|commits?|sessions?|taste|choices?|PRs?)\b/i);
  });
});
