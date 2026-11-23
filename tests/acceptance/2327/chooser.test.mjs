// #2327 acceptance, criterion 3 (#2327.030459ba): .github/ISSUE_TEMPLATE/config.yml lists the
// private route as a contact link beside the task template, and `node scripts/repo-rules.mjs` reads
// it: a planted config.yml without the link fails, naming the file.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIG, ROUTE, TEMPLATES, assertChecked, assertFails, checkoutFiles, read, rules, tree } from './helpers.mjs';

const unquote = (value) => value.replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2').trim();

/** The contact links of a config.yml written in block style: one `- ` item per link, one key per line. */
function contactLinks(text) {
  const lines = text.split('\n').filter((line) => !/^\s*#/.test(line));
  const start = lines.findIndex((line) => /^contact_links:\s*(?:#.*)?$/.test(line));
  if (start < 0) return null;
  const links = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (/^\s*-\s/.test(line)) links.push({});
    const field = line.match(/^\s*(?:-\s+)?(name|url|about):\s*(.*?)\s*$/);
    if (field && links.length) links.at(-1)[field[1]] = unquote(field[2]);
  }
  return links;
}

test('#2327.030459ba config.yml lists the private route as a contact link, beside the task template', () => {
  const text = read(CONFIG);
  assert.ok(text !== null, `${CONFIG} is missing, so the issue chooser shows no contact link`);
  const links = contactLinks(text);
  assert.ok(links !== null, `${CONFIG} has no contact_links list`);
  const link = links.find(({ url }) => url === ROUTE);
  assert.ok(link || !text.includes(ROUTE), `INCONCLUSIVE: ${CONFIG} names ${ROUTE}, but not in a block-style contact_links item this test can read`);
  assert.ok(link, `no contact link in ${CONFIG} has the url ${ROUTE}; its links are ${JSON.stringify(links)}`);
  // The forge shows a contact link only when it has all three of name, url and about.
  assert.ok(link.name && link.about, `the contact link to the private route needs a name and an about for the chooser to show it; it is ${JSON.stringify(link)}`);
  assert.ok(read(`${TEMPLATES}/task.md`) !== null, `${TEMPLATES}/task.md, the task template the link is shown beside, is gone`);
});

const OTHER_LINK = `contact_links:\n  - name: The plan\n    url: https://github.com/windoliver/deepbuild/issues\n    about: The open issues are the plan.\n`;

test('#2327.030459ba a planted config.yml without the link fails, naming the file; with it the tree passes', (t) => {
  const files = checkoutFiles();
  assertFails(rules(tree(t, new Map(files).set(CONFIG, OTHER_LINK))), CONFIG, 'a config.yml whose only contact link goes elsewhere');
  assertChecked(rules(tree(t, files)), 'a copy of this checkout\'s files');
});

test('#2327.030459ba a planted tree with no config.yml fails, naming the file', (t) => {
  const files = checkoutFiles();
  const planted = new Map(files);
  planted.delete(CONFIG);
  assertFails(rules(tree(t, planted)), CONFIG, 'a tree without config.yml');
});
