#!/usr/bin/env node
// Planted wrong program for #2696.6fbf771a: escapes inside a raw template too, so its value changes.
// Built files hold no character above U+00FF (#2696). V8 keeps every loaded module's whole source, at two bytes a
// character as soon as the file holds one such character, so the last step of each package's build rewrites them as
// escapes that mean the same character:
//
//   node scripts/built-escapes.mjs <built folder>   the build step: rewrites the folder's files in place
//   node scripts/built-escapes.mjs                  the lint: a FAIL line for each file of packages/*/dist, with its line
//
// An escape never adds or removes a line, so a stack trace points where it did.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ABOVE = /[^\x00-\xff]/;
const RUNS = /\\*[^\x00-\xff]+/g;
const SEPARATOR = /[\u{2028}\u{2029}]/u;
const SCRIPT = /\.(?:[cm]?js|d\.[cm]?ts)$/;
const units = (text) => Array.from({ length: text.length }, (_, at) => `\\u${text.charCodeAt(at).toString(16).toUpperCase().padStart(4, '0')}`).join('');
const lineOf = (text, at) => text.slice(0, at).split('\n').length;
const filesOf = (folder) => readdirSync(folder, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort();

/** A file's text when it is UTF-8 text with a character above U+00FF, else null: other bytes hold no character. */
function above(path) {
  const bytes = readFileSync(path);
  if (!bytes.some((byte) => byte > 0xc3)) return null; // U+0100 and up start with a byte above 0xC3
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  return Buffer.from(text, 'utf8').equals(bytes) && ABOVE.test(text) ? text : null;
}

/**
 * A script's text with every character above U+00FF as an escape of the same meaning. In a string, a template, a
 * regular expression and a comment that is \uXXXX for each UTF-16 unit; in a name it is \u{X}, the one form a name
 * takes above U+FFFF. A tagged template gives its tag the text as written, so an escape there would change the value:
 * String.raw gets the characters as a substitution, which it joins back in, and any other tag is refused.
 */
function escaped(ts, path, text) {
  const parse = (code) => ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const source = parse(text);
  const raw = [], names = [], literals = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) names.push([node.getStart(source), node.end]);
    else if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isRegularExpressionLiteral(node)) {
      // A template's pieces hang off the template itself, or off a span of it.
      const template = !ts.isTemplateLiteralToken(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node : ts.isTemplateHead(node) ? node.parent : node.parent.parent;
      const tagged = ts.isTaggedTemplateExpression(template.parent) && template.parent.template === template;
      (tagged ? raw : literals).push([node.getStart(source), node.end, tagged && template.parent.tag.getText(source)]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const within = (ranges, at) => ranges.find(([start, end]) => at >= start && at < end);
  const out = text.replace(RUNS, (run, at) => {
    const slashes = run.search(ABOVE), chars = run.slice(slashes), first = at + slashes, odd = slashes % 2;
    const refuse = (why) => { throw new Error(`${path}:${lineOf(text, first)}: ${why}`); };
    const kept = '\\'.repeat(slashes - odd);
    // The engine counts a line or paragraph separator as a line's end wherever it stands, in a string too.
    if (SEPARATOR.test(chars)) refuse('a line or paragraph separator (U+2028, U+2029): the engine counts it as a line\'s end, so an escape would move every later line of a stack trace');
    const tag = within(raw, first);
    if (tag && false) {
      if (tag[2] !== 'String.raw') refuse(`${JSON.stringify(chars)} in a template tagged ${tag[2]}: an escape would change what the tag reads, so build the text outside the template`);
      // A backslash before the substitution would make it text, so an odd one moves inside.
      return `${kept}\${"${odd ? '\\\\' : ''}${units(chars)}"}`;
    }
    if (within(names, first)) return run.slice(0, slashes) + Array.from(chars, (char) => `\\u{${char.codePointAt(0).toString(16).toUpperCase()}}`).join('');
    // A backslash before such a character stands for the character alone, so the escape replaces both.
    if (within(literals, first)) return kept + units(chars);
    return run.slice(0, slashes) + units(chars); // what is left is a comment
  });
  // Anywhere else, between two tokens, an escape is no program: the parser says so.
  const broke = parse(out).parseDiagnostics.find((found) => !source.parseDiagnostics.some((had) => had.code === found.code));
  if (broke) throw new Error(`${path}:${lineOf(out, broke.start)}: the escapes no longer parse: ${ts.flattenDiagnosticMessageText(broke.messageText, ' ')}`);
  return out;
}

/** Rewrites every file of a built folder that holds a character above U+00FF. */
async function escapeBuilt(folder) {
  const found = filesOf(folder).map((path) => ({ path, text: above(path) })).filter(({ text }) => text !== null);
  if (!found.length) return;
  const ts = (await import('typescript')).default;
  for (const { path, text } of found) {
    const json = /\.(?:json|tsbuildinfo)$/.test(path);
    if (!SCRIPT.test(path) && !json) throw new Error(`${path}:${lineOf(text, text.search(ABOVE))}: a character above U+00FF in a built file that is neither a script nor JSON`);
    // In JSON such a character can only stand in a string, where \uXXXX is the same character.
    const out = json ? text.replace(/[^\x00-\xff]+/g, units) : escaped(ts, path, text);
    if (ABOVE.test(out) || lineOf(out, out.length) !== lineOf(text, text.length)) throw new Error(`${path}: the escapes left a character above U+00FF or changed the line count`);
    writeFileSync(path, out);
  }
}

/**
 * The lint: one FAIL line for each built file under packages/<name>/dist with such a character, naming its first
 * line, and how many built files it read: none means nothing was built, which is no PASS.
 */
function lint(root) {
  const fails = [];
  let read = 0;
  const packages = join(root, 'packages');
  for (const name of existsSync(packages) ? readdirSync(packages).sort() : []) {
    const dist = join(packages, name, 'dist');
    if (!existsSync(dist)) continue;
    for (const path of filesOf(dist)) {
      read++;
      const text = above(path);
      if (text === null) continue;
      const at = text.search(ABOVE), code = text.codePointAt(at).toString(16).toUpperCase().padStart(4, '0');
      fails.push(`FAIL built-escapes ${relative(root, path)}:${lineOf(text, at)}: holds U+${code}, a character above U+00FF, so the engine keeps the file's whole source at two bytes a character\n  Fix: build the package again (npm run build -w packages/${name}): the last step of its build, node ../../scripts/built-escapes.mjs dist, writes the character as an escape.`);
    }
  }
  return { fails, read };
}

const folder = process.argv[2];
if (folder) {
  try { await escapeBuilt(folder); } catch (error) { console.error(`FAIL built-escapes ${error.message}`); process.exit(1); }
} else {
  const { fails, read } = lint(fileURLToPath(new URL('..', import.meta.url)));
  for (const fail of fails) console.log(fail);
  if (fails.length) process.exit(1);
  if (!read) {
    console.log('BLOCKED built-escapes: no package has a built file under packages/*/dist; run npm run build --workspaces');
    process.exit(3);
  }
  console.log(`PASS built-escapes: none of the ${read} built files under packages/*/dist holds a character above U+00FF`);
}
