import ts from 'typescript';
import { stripRust } from './rust-source.mjs';

export const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx|rs|wgsl)$/;

const LITERAL = new Set([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.RegularExpressionLiteral, ts.SyntaxKind.JsxText]);
const KIND = { ts: ts.ScriptKind.TS, mts: ts.ScriptKind.TS, cts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, mjs: ts.ScriptKind.JS, cjs: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };

function scriptLiterals(path, text) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, KIND[path.slice(path.lastIndexOf('.') + 1)]);
  const literals = [];
  const visit = (node) => {
    if (LITERAL.has(node.kind)) literals.push([node.kind === ts.SyntaxKind.JsxText ? node.pos : node.getStart(file), node.end]);
    else ts.forEachChild(node, visit);
  };
  visit(file);
  return literals.sort((a, b) => a[0] - b[0]);
}

function literalsOf(path, text) {
  if (path.endsWith('.wgsl')) return [];
  if (!path.endsWith('.rs')) return scriptLiterals(path, text);
  const literals = [];
  stripRust(text, { keepComments: true, literals });
  return literals;
}

function commentsOf(text, literals, script, lineEnd) {
  const comments = [];
  let next = 0;
  let i = script && text.startsWith('#!') ? (lineEnd.exec(text)?.index ?? text.length) : 0;
  while ((i = text.indexOf('/', i)) !== -1) {
    while (next < literals.length && literals[next][1] <= i) next++;
    if (next < literals.length && literals[next][0] <= i) {
      i = literals[next][1];
    } else if (text[i + 1] === '/') {
      lineEnd.lastIndex = i;
      comments.push([i, lineEnd.exec(text)?.index ?? text.length]);
      i = comments.at(-1)[1];
    } else if (text[i + 1] === '*') {
      let end = i + 2;
      for (let depth = 1; depth && end < text.length;) {
        if (!script && text.startsWith('/*', end)) { depth++; end += 2; } else if (text.startsWith('*/', end)) { depth--; end += 2; } else end++;
      }
      comments.push([i, end]);
      i = end;
    } else i++;
  }
  return comments;
}

export function read(path, text) {
  if (!text.includes('//') && !text.includes('/*')) return { comments: [], literals: null };
  const literals = literalsOf(path, text);
  return { comments: commentsOf(text, literals, !/\.(?:rs|wgsl)$/.test(path), path.endsWith('.rs') ? /\n/g : path.endsWith('.wgsl') ? /[\n\v\f\r\u0085\u2028\u2029]/g : /[\n\r\u2028\u2029]/g), literals };
}

const WORD = /[\p{L}\p{N}_$]/u;
const OPERATORS = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '..=', '=>', '->', '::', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**', '..'];

export function tokens(path, text) {
  const found = read(path, text);
  const spans = [...found.comments.map(([from, to]) => [from, to, false]), ...(found.literals ?? literalsOf(path, text)).map(([from, to]) => [from, to, true])].sort((a, b) => a[0] - b[0]);
  const out = [];
  let next = 0;
  for (let i = 0; i < text.length;) {
    while (next < spans.length && spans[next][1] <= i) next++;
    const span = next < spans.length && spans[next][0] <= i ? spans[next] : null;
    const stop = span ? span[1] : next < spans.length ? spans[next][0] : text.length;
    let end = i + 1;
    if (span) end = stop;
    else if (WORD.test(text[i])) while (end < stop && WORD.test(text[end])) end++;
    else if (!/\s/.test(text[i])) end = i + (OPERATORS.find((operator) => text.startsWith(operator, i) && i + operator.length <= stop)?.length ?? 1);
    if (span ? span[2] : !/\s/.test(text[i])) out.push({ text: text.slice(i, end), at: i });
    i = end;
  }
  return out;
}
