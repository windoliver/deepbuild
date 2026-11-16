// The pack census (#1493): every public name of a familiar-names pack's reference in exactly one state. A pack names
// its census in pack.json (`"census": "census.json"`); the census names its reference (`reference.commit`, and
// `reference.files`, rows of scripts/fetch-lock.json read through scripts/fetch-lock.mjs, never committed) and its scope.
// `names` holds one row per name the listed files export, `{name, state, target?, reason?}`, with `state` one of
// mapped, refused or open; the mapped rows are the pack's aliases. `params` holds one row per constructor parameter of
// each mapped name, or each property its constructor sets when it takes one `parameters` object, mapped when the
// target recipe has an input of that name, unless its row refuses it (an input the recipe accepts and draws nothing
// from: the pack check's field.effect refuses a mapped one). `totals` counts both tables by state.
//
//   node scripts/census.mjs [--root <dir>]            rewrites each census from its reference, keeping states and reasons
//   node scripts/census.mjs --check [--root <dir>]    FAIL names each difference either way; a missing reference is BLOCKED
//   node scripts/census.mjs --counts [--root <dir>]   FAIL names each file and line whose "n of m" for a pack isn't its census's
//
// A word mapped at the merge base with origin/main (or at HEAD, with no origin/main) and refused now needs a break
// file, packs/<pack>/breaks/<issue>.txt, holding `census: <word> mapped -> refused` and a `workaround:` line, as the
// contract diff's do. It imports only node: built-ins.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATES = ['mapped', 'refused', 'open'];
const REASONS = ['imperative', 'renderer', 'superseded', 'no_counterpart'];
const FETCHER = fileURLToPath(new URL('fetch-lock.mjs', import.meta.url));
const FIX = `  Fix: Run node scripts/census.mjs to write each census from its reference, give each refused row a reason from ${REASONS.join(', ')}, keep the mapped rows equal to the pack's aliases, and commit a break file for a mapped word refused.`;
const say = (line) => console.log(line);

const args = process.argv.slice(2);
const mode = args.includes('--check') ? 'check' : args.includes('--counts') ? 'counts' : 'write';
const at = args.indexOf('--root');
const root = at === -1 ? process.cwd() : args[at + 1];
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

/** Each pack folder whose pack.json names a census: { folder, pack, census path }. */
function packs() {
  const dir = join(root, 'packs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((folder) => {
    const file = `packs/${folder}/pack.json`;
    if (!existsSync(join(root, file))) return [];
    const pack = read(file);
    return [{ folder, pack, path: typeof pack.census === 'string' ? `packs/${folder}/${pack.census}` : null }];
  });
}
const label = (p) => `${p.pack.name}@${String(p.pack.version).split('.')[0]}`;

/** The names a JavaScript file exports, and the files its `export *` lines re-export. */
function exportsOf(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const names = new Set(), stars = [];
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name && name !== 'default') names.add(name);
    }
  }
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:class|function\*?|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from\s*['"]([^'"]+)['"]/gm)) {
    if (m[1]) names.add(m[1]);
    else stars.push(m[2]);
  }
  return { names, stars };
}

/** The text between the bracket at `open` and its match. */
function inside(text, open) {
  const pair = { '(': ')', '{': '}' }[text[open]];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === text[open]) depth++;
    else if (text[i] === pair && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

/** A class's parameters: its constructor's arguments, or the properties it sets from one `parameters` object. */
function paramsOf(text, name) {
  const cls = text.search(new RegExp(`\\bclass\\s+${name}\\b`));
  if (cls === -1) return null;
  const ctor = text.indexOf('constructor(', cls);
  if (ctor === -1) return [];
  const list = inside(text, ctor + 'constructor'.length) ?? '';
  const args = [];
  let depth = 0, part = '';
  for (const ch of list) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { args.push(part); part = ''; } else part += ch;
  }
  args.push(part);
  const plain = args.map((a) => a.split('=')[0].trim()).filter((a) => /^[A-Za-z_$][\w$]*$/.test(a));
  if (plain.length !== 1 || plain[0] !== 'parameters') return plain;
  const body = inside(text, text.indexOf('{', ctor + 'constructor'.length + list.length)) ?? '';
  const set = [...body.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*=[^=]/g)].map((m) => m[1]);
  return [...new Set(set)].filter((p) => !/^is[A-Z]/.test(p) && p !== 'type' && p !== 'defines');
}

/** A census's reference files from the cache, or the lines that say why they can't be read. */
function reference(census) {
  const files = census.reference?.files, commit = census.reference?.commit;
  if (!Array.isArray(files) || !files.length || typeof commit !== 'string') return { fail: ['its reference names no commit and no files'] };
  let lock;
  try {
    lock = read('scripts/fetch-lock.json').files ?? [];
  } catch {
    return { blocked: ['scripts/fetch-lock.json can\'t be read'] };
  }
  const rows = files.map((path) => lock.find((r) => r.path === path) ?? path);
  const unlisted = rows.filter((r) => typeof r === 'string');
  if (unlisted.length) return { fail: unlisted.map((p) => `its reference file ${p} is no row of scripts/fetch-lock.json`) };
  const other = rows.filter((r) => !r.url.split('/').includes(commit));
  if (other.length) return { blocked: other.map((r) => `its reference names ${commit}, and the lock pins ${r.path} at ${r.url}`) };
  const run = spawnSync(process.execPath, [FETCHER, 'fetch', ...rows.map((r) => r.url)], { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) return { blocked: ['its reference isn\'t in the cache at its pin'], said: (run.stdout + run.stderr).trim() };
  const cache = join(homedir(), '.deepbuild', 'fetched');
  return { texts: new Map(files.map((p) => [p, readFileSync(join(cache, p), 'utf8')])) };
}

/** The reference's names and each mapped name's parameters, or why they can't be listed. */
function listing(texts, mapped) {
  const names = new Set(), fail = [];
  for (const [path, text] of texts) {
    const { names: own, stars } = exportsOf(text);
    own.forEach((n) => names.add(n));
    for (const star of stars) {
      const to = posix.join(posix.dirname(path), star);
      if (!texts.has(to)) fail.push(`${path} re-exports ${star}, which its reference doesn't list`);
    }
  }
  const params = new Map();
  for (const name of mapped) {
    for (const text of texts.values()) {
      const found = paramsOf(text, name);
      if (found) { params.set(name, found); break; }
    }
  }
  return { names, params, fail };
}

/** The recipe inputs an alias's target has, by the pack's recipe files. */
function inputs(p, target) {
  const file = p.pack.recipes?.[target];
  if (typeof file !== 'string') return new Set();
  return new Set(Object.keys(read(`packs/${p.folder}/${file}`).inputs ?? {}));
}

const count = (rows) => Object.fromEntries(STATES.map((s) => [s, rows.filter((r) => r.state === s).length]));

/** The census written from its reference: its rows kept, new names open, mapped rows as the aliases say. */
function written(p, census, list) {
  const aliases = p.pack.aliases ?? {};
  const old = new Map((census.names ?? []).map((r) => [r.name, r]));
  const names = [...list.names].sort().map((name) => {
    if (aliases[name]) return { name, state: 'mapped', target: aliases[name].target };
    const was = old.get(name);
    return was && was.state !== 'mapped' ? was : { name, state: 'open' };
  });
  const oldParams = new Map((census.params ?? []).map((r) => [`${r.name}.${r.param}`, r]));
  const params = [...list.params].sort(([a], [b]) => a.localeCompare(b)).flatMap(([name, found]) => {
    const has = inputs(p, aliases[name].target);
    // A parameter the recipe accepts by name and draws nothing from stays refused, as its row says: the pack check's
    // field.effect holds every mapped one to the frame.
    return found.map((param) => {
      const was = oldParams.get(`${name}.${param}`);
      if (was?.state === 'refused') return was;
      if (has.has(param)) return { name, param, state: 'mapped', target: param };
      return was && was.state !== 'mapped' ? was : { name, param, state: 'open' };
    });
  });
  return { ...census, names, params, totals: { names: count(names), params: count(params) } };
}

/** The census at the merge base, or at HEAD with no origin/main; null when git has none. */
function before(path) {
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  const base = git('merge-base', 'HEAD', 'origin/main');
  const rev = base.status === 0 ? base.stdout.trim() : 'HEAD';
  const shown = git('show', `${rev}:${path}`);
  if (shown.status !== 0) return null;
  try {
    return JSON.parse(shown.stdout);
  } catch {
    return null;
  }
}

/** Each difference between a census and its pack, its reference and its history, as one line. */
function differences(p, census, list) {
  const found = [], aliases = p.pack.aliases ?? {};
  const rows = Array.isArray(census.names) ? census.names : [];
  const params = Array.isArray(census.params) ? census.params : [];
  const byName = new Map();
  for (const r of rows) {
    if (byName.has(r.name)) found.push(`${r.name} has more than one row`);
    byName.set(r.name, r);
  }
  for (const r of [...rows, ...params]) {
    const word = r.param ? `${r.name}.${r.param}` : r.name;
    if (!STATES.includes(r.state)) found.push(`${word}'s row is ${JSON.stringify(r.state)}, not mapped, refused or open`);
    if (r.state === 'refused' && !REASONS.includes(r.reason)) found.push(`${word} is refused with ${r.reason ? `the reason ${JSON.stringify(r.reason)}, not one from the list` : 'no reason'}`);
  }
  for (const [word, alias] of Object.entries(aliases)) {
    const r = byName.get(word);
    if (!r) found.push(`the alias ${word} has no row`);
    else if (r.state !== 'mapped') found.push(`the alias ${word} has a row that is ${r.state}, not mapped`);
    else if (r.target !== alias.target) found.push(`${word}'s row maps to ${r.target}, and its alias to ${alias.target}`);
  }
  for (const r of rows) if (r.state === 'mapped' && !aliases[r.name]) found.push(`${r.name}'s row is mapped, and the pack has no alias ${r.name}`);
  for (const [table, list_] of [['names', rows], ['params', params]]) {
    const want = count(list_), have = census.totals?.[table] ?? {};
    if (STATES.some((s) => have[s] !== want[s])) found.push(`its ${table} totals are ${JSON.stringify(have)}, and its rows count ${JSON.stringify(want)}`);
  }
  if (list) {
    found.push(...list.fail);
    for (const name of list.names) if (!byName.has(name)) found.push(`${name} is a name of its reference with no row`);
    for (const r of rows) if (!list.names.has(r.name)) found.push(`${r.name}'s row names no name of its reference`);
    const want = written(p, census, list).params.map((r) => `${r.name}.${r.param} ${r.state === 'mapped' ? 'mapped' : 'unmapped'}`);
    const have = params.map((r) => `${r.name}.${r.param} ${r.state === 'mapped' ? 'mapped' : 'unmapped'}`);
    for (const w of want) if (!have.includes(w)) found.push(`the parameter ${w.replace(' unmapped', ' (open or refused)')} has no such row`);
    for (const h of have) if (!want.includes(h)) found.push(`the parameter row ${h.replace(' unmapped', ' (open or refused)')} is no parameter of its reference in that state`);
  }
  const was = before(p.path);
  const breaks = join(root, 'packs', p.folder, 'breaks');
  const files = existsSync(breaks) ? readdirSync(breaks).filter((f) => f.endsWith('.txt')).map((f) => readFileSync(join(breaks, f), 'utf8').split('\n')) : [];
  for (const old of was?.names ?? []) {
    if (old.state !== 'mapped' || byName.get(old.name)?.state !== 'refused') continue;
    const line = `census: ${old.name} mapped -> refused`;
    if (!files.some((lines) => lines.includes(line) && lines.some((l) => /^workaround:\s*\S/.test(l)))) found.push(`${old.name} moved from mapped to refused with no break file packs/${p.folder}/breaks/<issue>.txt holding "${line}" and a workaround line`);
  }
  return found;
}

function check() {
  let failed = 0, blocked = 0;
  const passed = [];
  for (const p of packs()) {
    if (!p.path) {
      if (Object.keys(p.pack.aliases ?? {}).length) say(`NOTE census: ${label(p)} maps ${Object.keys(p.pack.aliases).length} words and keeps no census, so no count of it can be quoted`);
      continue;
    }
    let census;
    try {
      census = read(p.path);
    } catch (error) {
      say(`FAIL census: ${label(p)}: ${p.path} can't be read: ${error.code ?? error.message}`);
      failed++;
      continue;
    }
    const ref = reference(census);
    const mapped = Object.keys(p.pack.aliases ?? {});
    const list = ref.texts ? listing(ref.texts, mapped) : null;
    const found = [...(ref.fail ?? []), ...differences(p, census, list)];
    for (const line of found) say(`FAIL census: ${label(p)}: ${line}`);
    failed += found.length;
    if (ref.blocked) {
      blocked++;
      for (const line of ref.blocked) say(`BLOCKED census: ${label(p)}: ${line}, so its census isn't checked against it`);
      if (ref.said) say(ref.said.split('\n').map((l) => `  ${l}`).join('\n'));
    } else if (!found.length) passed.push(`${label(p)} maps ${census.totals.names.mapped} of ${census.names.length} names (${census.scope})`);
  }
  if (failed) say(FIX);
  if (failed) return 1;
  if (blocked) return 3;
  say(`PASS census: ${passed.length ? passed.join('; ') : 'no pack keeps a census'}`);
  return 0;
}

function write() {
  let code = 0;
  for (const p of packs().filter((p) => p.path)) {
    const census = read(p.path);
    const ref = reference(census);
    const why = ref.fail ?? ref.blocked;
    if (why) {
      for (const line of why) say(`${ref.fail ? 'FAIL' : 'BLOCKED'} census: ${label(p)}: ${line}`);
      if (ref.said) say(ref.said);
      code = ref.fail ? 1 : 3;
      continue;
    }
    const list = listing(ref.texts, Object.keys(p.pack.aliases ?? {}));
    for (const line of list.fail) say(`FAIL census: ${label(p)}: ${line}`);
    if (list.fail.length) { code = 1; continue; }
    const next = written(p, census, list);
    writeFileSync(join(root, p.path), JSON.stringify(next, null, 2) + '\n');
    say(`census: ${label(p)}: ${next.totals.names.mapped} of ${next.names.length} names mapped, ${next.totals.params.mapped} of ${next.params.length} parameters, written to ${p.path}`);
  }
  return code;
}

/** Each "n of m" a line quotes for a pack, against that pack's census. */
function counts() {
  const all = packs();
  const byLabel = new Map(all.map((p) => [label(p), p]));
  const files = [];
  const gallery = join(root, 'crates/deep-show/gallery');
  if (existsSync(gallery)) files.push(...readdirSync(gallery).filter((f) => f.endsWith('.md')).map((f) => `crates/deep-show/gallery/${f}`));
  for (const f of ['README.md']) if (existsSync(join(root, f))) files.push(f);
  let failed = 0, quoted = 0;
  for (const file of files.sort()) {
    readFileSync(join(root, file), 'utf8').split('\n').forEach((text, i) => {
      const named = [...text.matchAll(/\b([a-z][a-z0-9-]*@\d+)\b/g)].map((m) => byLabel.get(m[1])).filter(Boolean);
      const nums = [...text.matchAll(/\b(\d+) of (\d+)\b/g)];
      if (!named.length || !nums.length) return;
      quoted++;
      const p = named[0];
      const census = p.path && existsSync(join(root, p.path)) ? read(p.path) : null;
      const want = census ? [census.totals?.names?.mapped, census.names?.length] : null;
      for (const m of nums) {
        const got = [Number(m[1]), Number(m[2])];
        if (want && got[0] === want[0] && got[1] === want[1]) continue;
        failed++;
        say(`FAIL census: ${file}:${i + 1}: quotes ${m[1]} of ${m[2]} for ${label(p)}, ${want ? `and its census maps ${want[0]} of ${want[1]}` : 'which keeps no census to read it from'}`);
      }
    });
  }
  if (failed) {
    say('  Fix: Quote a pack\'s count as its census has it, read from packs/<pack>/census.json, with its scope beside it.');
    return 1;
  }
  say(`PASS census: ${quoted} lines quote a pack's count, each as its census has it`);
  return 0;
}

process.exitCode = mode === 'check' ? check() : mode === 'counts' ? counts() : write();
