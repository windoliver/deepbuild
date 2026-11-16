// PR calls in a shell line (#2064). Read words and heredocs without running the shell: an expansion we cannot read
// is never an empty body. The gate, post-call lookup and cut-off-send reader use the same command boundaries.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { forgeOf } from './paths.js';
import { closingIssues } from './forge.js';

type Word = { text: string; literal: boolean };
type Command = { words: Word[]; input?: Word; file?: Word; error?: string; redirects?: boolean };
export interface PrCommand extends Command { verb: 'create' | 'edit'; folder: string; changed: boolean }

/** A heredoc ends at its delimiter alone; <<- removes leading tabs, not spaces. */
function heredoc(text: string, from: number, tag: Word, dash: boolean): { body: Word; end: number } {
  let body = '';
  for (let at = from; at <= text.length;) {
    const nl = text.indexOf('\n', at);
    const end = nl < 0 ? text.length : nl;
    const line = text.slice(at, end).replace(dash ? /^\t+/ : /^$/, '');
    if (line === tag.text) return { body: { text: body, literal: tag.literal || !/[$`\\]/.test(body) }, end: nl < 0 ? end : end + 1 };
    body += line + (nl < 0 ? '' : '\n');
    if (nl < 0) break;
    at = end + 1;
  }
  throw Error(`unterminated heredoc ${tag.text}`);
}

/** Simple shell commands, preserving whether each argument is known, and keeping heredoc text out of the commands. */
function commands(text: string): Command[] {
  const out: Command[] = [];
  let current: Command = { words: [] }, at = 0;
  const pending: { command: Command; tag: Word; dash: boolean }[] = [];
  const finish = () => { if (current.words.length) out.push(current); current = { words: [] }; };
  const word = (): Word => {
    let value = '', quote = '', literal = true;
    while (at < text.length) {
      const c = text[at]!;
      if (!quote && /[\s;&|()<>]/.test(c)) break;
      at++;
      if (quote === "'") { if (c === "'") quote = ''; else value += c; continue; }
      if (c === '\\') {
        const next = text[at];
        if (next !== undefined && (!quote || /[$`"\\\n]/.test(next))) { at++; if (next !== '\n') value += next; }
        else value += c;
        continue;
      }
      if (c === '"' || c === "'") {
        if (quote === c) quote = '';
        else if (!quote) quote = c;
        else value += c;
        continue;
      }
      if (c === '$' && text[at] === '(') {
        const doc = /^\([ \t]*cat[ \t]+<<(-?)[ \t]*(["']?)([\w-]+)\2[ \t]*\n/.exec(text.slice(at));
        if (doc) {
          const got = heredoc(text, at + doc[0].length, { text: doc[3]!, literal: !!doc[2] }, doc[1] === '-');
          const close = /^[ \t]*\)/.exec(text.slice(got.end));
          if (!close) throw Error('unreadable heredoc command substitution');
          value += got.body.text.replace(/\n+$/, '');
          literal &&= got.body.literal;
          at = got.end + close[0].length;
          continue;
        }
        // Other substitutions are not evaluated. Read any PR they run as well, but never guess their output.
        const start = ++at;
        let depth = 1, quoted = '';
        while (at < text.length && depth) {
          const next = text[at++]!;
          if (next === '\\') { at++; continue; }
          if (quoted) { if (next === quoted) quoted = ''; }
          else if (next === '"' || next === "'") quoted = next;
          else if (next === '(') depth++;
          else if (next === ')') depth--;
        }
        out.push(...commands(text.slice(start, depth ? at : at - 1)));
        literal = false;
        continue;
      }
      if (c === '`') {
        const end = text.indexOf('`', at);
        out.push(...commands(text.slice(at, end < 0 ? text.length : end)));
        at = end < 0 ? text.length : end + 1;
        literal = false;
        continue;
      }
      if (c === '$' || !quote && /[~*?\[]/.test(c)) literal = false;
      value += c;
    }
    if (quote) throw Error('unterminated shell quote');
    return { text: value, literal };
  };
  try {
    while (at < text.length) {
      if (text[at] === '\n') {
        at++;
        finish();
        for (const doc of pending.splice(0)) {
          const got = heredoc(text, at, doc.tag, doc.dash);
          doc.command.input = got.body;
          at = got.end;
        }
      } else if (/\s/.test(text[at]!)) at++;
      else if (text[at] === '#') { const nl = text.indexOf('\n', at); at = nl < 0 ? text.length : nl; }
      else if (/[;&|()]/.test(text[at]!) && !text.slice(at).startsWith('&>')) { at++; finish(); }
      else {
        const redirect = /^(?:\d*|&)(<<<|<<-?|>>?|<)(?:&)?/.exec(text.slice(at));
        if (redirect) {
          current.redirects = true;
          at += redirect[0].length;
          while (/[ \t]/.test(text[at] ?? '')) at++;
          const quoted = text[at] === "'" || text[at] === '"';
          const target = word();
          if (redirect[1]!.startsWith('<<') && redirect[1] !== '<<<') pending.push({ command: current, tag: { text: target.text, literal: quoted }, dash: redirect[1] === '<<-' });
          else if (redirect[1] === '<') current.file = target;
          else if (redirect[1] === '<<<') current.input = { ...target, text: target.text + '\n' };
          if (!target.text) throw Error('unreadable shell redirection');
        } else current.words.push(word());
      }
    }
    if (pending.length) throw Error(`missing heredoc ${pending[0]!.tag.text}`);
  } catch (error) {
    current.error = error instanceof Error ? error.message : String(error);
    for (const doc of pending) doc.command.error = current.error;
  }
  finish();
  return out;
}

/** Every PR create/edit, not an echo of one or a line inside a body. Directory changes remain relative to the hook. */
export function prCommands(command: string): PrCommand[] {
  const found: PrCommand[] = [];
  let folder = '.', changed = false, error: string | undefined;
  for (const part of commands(command)) {
    const w = part.words;
    while (w.length) {
      const name = w[0]!.text.replace(/^.*\//, '');
      if (/^(?:\{|then|do|if|elif|else|while|until|!|command|exec|time|nohup)$/.test(name) || /^[A-Za-z_]\w*=/.test(name)) { w.shift(); continue; }
      if (name !== 'env' && name !== 'sudo') break;
      w.shift();
      while (w[0]?.text.startsWith('-')) {
        const option = w.shift()!.text;
        if (option === '--') break;
        if (/^(?:-u|--unset|--user|-g|--group|-C|--chdir)$/.test(option)) w.shift();
        if (/^(?:-C|--chdir|--chdir=)/.test(option)) error = 'cannot read the wrapper working directory';
      }
    }
    const program = w[0]?.text.replace(/^.*\//, '');
    const script = program === 'eval' ? w.slice(1).map((x) => x.text).join(' ') : /^(?:ba|da|z|k)?sh$/.test(program ?? '')
      ? w[w.findIndex((x) => /^-[^-]*c/.test(x.text)) + 1]?.text : undefined;
    if (script !== undefined && (program === 'eval' || w.some((x) => /^-[^-]*c/.test(x.text)))) {
      found.push(...prCommands(script).map((pr) => ({ ...pr, folder: join(folder, pr.folder), changed: changed || pr.changed, ...w.some((x) => !x.literal) ? { error: 'cannot read an expanded shell script' } : {} })));
      changed = true;
    } else if (w[0]?.text === 'cd') {
      if (w.length === 2 && w[1]!.literal) folder = isAbsolute(w[1]!.text) ? w[1]!.text : join(folder, w[1]!.text);
      else error = 'cannot read the working directory before the pull request';
    } else if (w[0]?.literal && /(?:^|\/)gh$/.test(w[0].text) && w[1]?.text === 'pr' && /^(create|edit)$/.test(w[2]?.text ?? '')) {
      found.push({ ...part, verb: w[2]!.text as 'create' | 'edit', folder, changed, ...(error ? { error } : {}) });
    } else if (part.redirects || !(w[0]?.text === 'git' && /^(push|status|diff|log|show)$/.test(w[1]?.text ?? ''))) changed = true;
  }
  return found;
}

/** Resolve every body before applying the existing closing and partial-delivery rules. */
export async function gatePrBodies(command: string, cwd: string, closing: (issue: number) => Promise<string | undefined>, partial: (body: string) => Promise<string | undefined>): Promise<string | undefined> {
  for (const pr of prCommands(command)) {
    const origin = forgeOf(resolve(cwd, pr.folder));
    const repo = origin?.slice(origin.indexOf('/') + 1);
    const body = await prBody(pr, cwd);
    if (body === undefined) continue;
    const args = flags(pr);
    // An explicit description does not replace gh's filled title. Read that subject too, without pretending the
    // omitted commit bodies will be sent; an explicit --title replaces it and needs no fill-title lookup.
    const filledTitle = !args.has('title') && (args.has('body') || args.has('body-file')) && ['fill', 'fill-first', 'fill-verbose'].some((name) => args.has(name))
      ? await prBody(pr, cwd, true) : '';
    for (const issue of closingIssues(`${filledTitle ?? ''}\n${body}`, repo)) {
      const denied = await closing(issue);
      if (denied) return denied;
    }
    const denied = await partial(body);
    if (denied) return denied;
  }
  return undefined;
}

// Values are consumed once: a title or body whose entire text is "--body-file" is not another flag.
function flags(pr: PrCommand): Map<string, string> {
  const out = new Map<string, string>();
  const aliases: Record<string, string> = { b: 'body', F: 'body-file', B: 'base', H: 'head', t: 'title', R: 'repo', f: 'fill', e: 'editor', w: 'web', T: 'template', a: 'assignee', l: 'label', r: 'reviewer', p: 'project', m: 'milestone', d: 'draft' };
  const booleans = new Set(['fill', 'fill-first', 'fill-verbose', 'editor', 'web', 'draft', 'dry-run', 'help', 'no-maintainer-edit']);
  for (let i = 3; i < pr.words.length; i++) {
    const w = pr.words[i]!;
    if (!w.literal) throw Error('cannot read the pull request arguments: shell expansion');
    if (w.text === '--') break;
    if (!w.text.startsWith('-')) continue;
    const split = w.text.startsWith('--') ? /^--([^=]+)(?:=([\s\S]*))?$/.exec(w.text) : /^-([A-Za-z])([\s\S]*)$/.exec(w.text);
    if (!split) throw Error(`cannot read pull request flag ${w.text}`);
    const name = w.text.startsWith('--') ? split[1]! : aliases[split[1]!] ?? split[1]!;
    const inline = split[2] || (w.text.includes('=') ? '' : undefined);
    const value = inline !== undefined ? { text: w.text.startsWith('--') ? inline : inline.replace(/^=/, ''), literal: true } : booleans.has(name) ? { text: 'true', literal: true } : pr.words[++i];
    if (!value?.literal) throw Error(`cannot read --${name}: its value is missing or needs shell expansion`);
    out.set(name, value.text);
  }
  return out;
}

/** Read-only git, by argv, never a shell evaluation of the guarded command. */
async function git(cwd: string, args: string[]): Promise<string> {
  // Parsing a command on the socket thread needs no gate; only a PR body read needs its Git environment.
  const { gitEnv } = await import('@deepbuild/gate');
  return new Promise((done, fail) => execFile('git', args, { cwd, env: gitEnv(), timeout: 2000, maxBuffer: 1 << 20 }, (error, out) => error ? fail(error) : done(out.trimEnd())));
}

/** The body to judge; edit calls that do not change it leave it alone. Unreadable bodies throw, so the gate refuses. */
export async function prBody(pr: PrCommand, cwd: string, titleOnly = false): Promise<string | undefined> {
  if (pr.error) throw Error(pr.error);
  cwd = resolve(cwd, pr.folder);
  const args = flags(pr);
  if (['editor', 'web', 'recover'].some((name) => args.has(name))) throw Error('the pull request body will be supplied interactively and cannot be read');
  const body = args.get('body');
  const file = args.get('body-file');
  if (file !== undefined && !titleOnly) {
    if (pr.changed) throw Error(`cannot read body file ${file} before the preceding commands run`);
    if (file !== '-') return readFile(resolve(cwd, file), 'utf8');
    if (pr.input?.literal) return pr.input.text;
    if (pr.file?.literal) return readFile(resolve(cwd, pr.file.text), 'utf8');
    throw Error('cannot read --body-file -: standard input is not a literal heredoc or file');
  }
  if (body !== undefined && !titleOnly) return body;
  if (['fill', 'fill-first', 'fill-verbose'].some((name) => args.has(name))) {
    if (pr.changed) throw Error('cannot read --fill before the preceding commands change the checkout');
    const head = args.get('head') ?? 'HEAD';
    const base = args.get('base');
    const branch = await git(cwd, ['branch', '--show-current']);
    const configured = base ?? await git(cwd, ['config', '--get', `branch.${branch}.gh-merge-base`]).catch(() => undefined);
    const candidates = configured ? [`refs/remotes/origin/${configured}`, configured] : ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master'];
    let baseSha: string | undefined;
    for (const ref of candidates) {
      baseSha = await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).catch(() => undefined);
      if (baseSha) break;
    }
    if (!baseSha) throw Error(`cannot read --fill: base branch ${configured ?? 'of the pull request'} is unavailable`);
    const headSha = await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${head}^{commit}`]);
    // gh uses the right side of the symmetric difference, without merges or patch-equivalent commits. A single
    // commit supplies its subject as the title and its body as the body; many supply only subjects unless verbose.
    const messages = await git(cwd, ['-c', 'log.showSignature=false', 'log', '--cherry', '--format=%s%x00%b%x00', `${baseSha}...${headSha}`, '--']);
    const commits = [...messages.matchAll(/(?:^|\n)([^\0]*)\0([^\0]*)\0/g)].map((m) => ({ title: m[1]!, body: m[2]! })).reverse();
    if (!commits.length) throw Error('cannot read --fill: no commits between the base and head');
    const first = commits[0]!;
    if (titleOnly) return commits.length === 1 || args.has('fill-first') ? first.title : '';
    if (commits.length === 1 || args.has('fill-first')) {
      // Without --title the subject is also a closing claim the PR carries (AC2); an explicit title replaces it.
      return `${args.has('title') ? '' : `${first.title}\n\n`}${first.body}`;
    }
    return commits.map((c) => `- **${c.title}**\n${args.has('fill-verbose') ? c.body.replace(/^/gm, '  ') : ''}`).join(args.has('fill-verbose') ? '\n\n' : '');
  }
  if (pr.verb === 'edit') return undefined;
  throw Error('cannot read the pull request body: supply --body, --body-file or --fill');
}
