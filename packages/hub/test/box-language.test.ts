// #2403: the app's language is a preference you change in words in the box (#1998), with no Settings page. "use
// Chinese" drafts a proposal, and approving it writes `language` in config.json, which the app reads at its next launch;
// "use the system language" takes it out again. Words naming no language the app has draft nothing of the kind.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { Box } from '../src/box.ts';

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function box(): { box: Box; root: string; asks: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'box-language-'));
  roots.push(root);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ sounds: true })}\n`);
  const asks: string[] = [];
  const b = new Box({
    root, plant: undefined, now: () => Date.UTC(2026, 10, 18),
    raise: async () => { const id = `ask:${asks.length + 1}`; asks.push(id); return id; },
    folders: async () => [], lessons: async () => [], forget: async () => undefined, learn: async () => undefined,
  });
  return { box: b, root, asks };
}

const config = (root: string): Record<string, unknown> => JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')) as Record<string, unknown>;

it('approving "use Chinese" in the box draws the app in Simplified Chinese from its next launch, and "use the system language" follows macOS again', async () => {
  const { box: b, root } = box();
  const said = await b.say('use Chinese');
  expect(said.question, 'the proposal names the language').toMatch(/Simplified Chinese/);
  expect(config(root).language, 'nothing changes before you approve').toBeUndefined();
  expect(b.delivered(String(said.ask), 'apply')).toBe(true);
  await b.say('learn again'); // the box answers in order, so the approval above has been carried out by now
  expect(config(root)).toEqual({ sounds: true, language: 'zh-Hans' });
  expect((await b.say('用中文')).unread, 'saying it again changes nothing').toMatch(/already draws in Simplified Chinese/);

  const back = await b.say('use the system language');
  b.delivered(String(back.ask), 'apply');
  await b.say('learn again');
  expect(config(root)).toEqual({ sounds: true });
});

it('words that name no language the app has draft no language change', async () => {
  const { box: b, root } = box();
  for (const words of ['use bun', 'useless', 'speak klingon']) {
    const said = await b.say(words);
    expect(said.question ?? '', words).not.toMatch(/Draw the app in/);
  }
  expect(config(root).language).toBeUndefined();
});
