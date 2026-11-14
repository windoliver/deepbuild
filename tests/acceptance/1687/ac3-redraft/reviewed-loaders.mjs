// Approved AC3 completeness substitution: frozen source review, not a dynamic-import exemption.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { corePackages, graph, syntaxDigest } from './graph.mjs';

export const review = JSON.parse(readFileSync(new URL('./reviewed-loaders.json', import.meta.url), 'utf8'));
const identity = ({ from, expressionDigest, scopeDigest }) => `${from}:${expressionDigest}:${scopeDigest}`;
const digest = (file, text) => syntaxDigest(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));

export function reviewedGraph(snapshot, frozen = review.current) {
  const value = graph(snapshot);
  const actual = value.unknown.map(identity).sort();
  const expected = frozen.sites.map(identity).sort();
  const problems = [];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push('new, removed or changed/unreviewed computed loader');
  for (const [file, hash] of Object.entries(frozen.inputs)) {
    if (!snapshot.texts.has(file) || digest(file, snapshot.texts.get(file)) !== hash) problems.push(`reviewed input/guard changed: ${file}`);
  }
  const edges = [];
  for (const site of frozen.sites) {
    if (site.kind === 'literal') edges.push({ from: site.from, spec: site.target, runtime: true, line: site.line });
    if (site.kind === 'hub-directory') {
      // Even the planted whole-hub loader contributes all resolvable edges, including its self-edge.
      for (const file of value.nodes) if (/^packages\/hub\/src\/[^/]+\.ts$/.test(file) && !file.endsWith('.d.ts')) {
        edges.push({ from: site.from, spec: `./${file.split('/').at(-1).replace(/\.ts$/, '.js')}`, runtime: true, line: site.line });
      }
    }
  }
  const augmented = graph(snapshot, edges);
  const pending = [...value.nodes].filter((file) => corePackages.has(file.split('/')[1]) || file === 'packages/hub/src/core.ts');
  const seen = new Set();
  const adjacency = new Map();
  for (const edge of augmented.edges) adjacency.set(edge.from, [...adjacency.get(edge.from) ?? [], edge.to]);
  while (pending.length) {
    const at = pending.pop(); if (seen.has(at)) continue;
    seen.add(at); pending.push(...adjacency.get(at) ?? []);
  }
  for (const site of frozen.sites) {
    if (site.kind === 'outer-test-provider' && seen.has(site.from)) problems.push(`arbitrary provider loader is reachable from core: ${site.from}`);
    if (site.kind === 'blocked') problems.push(site.boundary);
  }
  // Freeze the inward provider arguments as well: moving an import outward is not permission
  // for core to choose a concrete extension path through the provider callback.
  const providerCalls = [];
  // extensionSide's default import(file) is unused in production. A new caller cannot silently activate it.
  const calls = [];
  for (const [file, text] of snapshot.texts) {
    if (file.endsWith('.json')) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isCallExpression(node) && /(?:providers\.(?:environment\.host|knowledge\.index)|createCore)$/.test(node.expression.getText(source))) {
        providerCalls.push(`${file}:${syntaxDigest(node)}`);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'extensionSide') {
        calls.push(`${file}:${node.arguments.length}:${syntaxDigest(node)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  if (JSON.stringify(calls.sort()) !== JSON.stringify(frozen.extensionSideCalls)) problems.push('extensionSide caller/input boundary changed');
  if (JSON.stringify(providerCalls.sort()) !== JSON.stringify(frozen.providerCalls)) problems.push('outer provider caller/input boundary changed');
  return { ...augmented, reviewProblems: problems };
}

export function completeReview(value) {
  assert.deepEqual(value.reviewProblems, [], 'BLOCKED: computed loader review is incomplete or its contract changed');
}

// A fixture changes the actual program snapshot, not the frozen table; it must trip the acceptance assertion.
export function changedSnapshot(snapshot, file, text) {
  return { paths: new Set([...snapshot.paths, file]), texts: new Map([...snapshot.texts, [file, text]]) };
}
