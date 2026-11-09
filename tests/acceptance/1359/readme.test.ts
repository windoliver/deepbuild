// #1359 AC8 (README): the checkout's README says which commands set the machine up, the next step, rebuilding after a
// pull, and the undo; and no longer that running the checkout installs no hooks and starts no service (item 8).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECKOUT } from './helpers.ts';

const ID = '#1359.25f84fb7';
const readme = () => readFileSync(join(CHECKOUT, 'README.md'), 'utf8');
/** The README's paragraphs, white space collapsed, a list item or a fenced block each one. */
const paragraphs = () => readme().split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);

describe(`${ID} the README on running the checkout`, () => {
  it(`${ID} no longer says running the checkout installs no hooks and starts no service`, () => {
    expect(readme().replace(/\s+/g, ' ')).not.toMatch(/installs no hooks and starts no service/i);
  });
  it(`${ID} says which commands set the machine up`, () => {
    // Setup's own command, and the first command you run yourself that sets up a home nobody set up (#326, item 1).
    const said = paragraphs().filter((p) => /\bsets?\b[^.]*\bup\b/i.test(p) && p.includes('deep setup') && p.includes('deep status'));
    expect(said, 'a paragraph saying that `deep setup` and the first `deep status` set DeepBuild up').not.toEqual([]);
  });
  it(`${ID} says the next step: start a Claude Code or Codex session`, () => {
    expect(paragraphs().some((p) => /\bstart\b/i.test(p) && p.includes('Claude Code') && p.includes('Codex') && /\bsession\b/.test(p)), 'a paragraph saying to start a Claude Code or Codex session').toBe(true);
  });
  it(`${ID} says to build again after a pull`, () => {
    expect(paragraphs().some((p) => /\bnpm run build\b/.test(p) && /\bpull\b/i.test(p)), 'a paragraph saying to run npm run build again after a pull').toBe(true);
  });
  it(`${ID} names the undo, deep setup --undo`, () => {
    expect(readme()).toContain('deep setup --undo');
  });
});
