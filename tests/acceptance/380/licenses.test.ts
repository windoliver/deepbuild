// #380.993f9e93: every ported shader keeps its license beside it, and none comes from a GPL source or
// under Shadertoy's default license.
// The `operators` call lists every shipped operator with the shaders it ports (`ported`: the files, where
// they came from, their SPDX license and the notice file): the issue's proof line, "the list of ported
// shaders with their licenses". For each: the files are in the checkout; the notice is a file in the same
// folder as each of them ("beside it") whose text is that license's; each file names its source and license
// in its header (AGENTS.md: ported code keeps its license notice in the receiving file); the license is not
// GPL, LGPL or AGPL, and not Shadertoy's default (CC BY-NC-SA 3.0 Unported) or any other NonCommercial or
// ShareAlike Creative Commons license. A scan of every shader source in the checkout's crates and packages
// then finds no GPL or Shadertoy-default license text and no Shadertoy source a listing leaves out. Each
// check's own twin (a GPL port, a Shadertoy port under its default license, a notice missing or in another
// folder, a shader file holding GPL text) fails it, named. At the base `deep-gpu` has no operators call.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPERATORS, REPO, operatorsReply, run1, shippedEffects, useBin, useOut, type Operator, type Ported } from './helpers.ts';

const bins = useBin();
const out = useOut();

/** Each permissive license a port may carry, by the words its text always holds. */
const LICENSE_TEXT: Record<string, RegExp> = {
  'MIT': /Permission is hereby granted, free of charge/,
  'MIT-0': /Permission is hereby granted, free of charge/,
  'Apache-2.0': /Apache License[\s\S]*Version 2\.0/,
  'BSD-2-Clause': /Redistribution and use in source and binary forms/,
  'BSD-3-Clause': /Redistribution and use in source and binary forms/,
  'ISC': /Permission to use, copy, modify, and\/or distribute/,
  'Zlib': /This software is provided ['‘]as-is['’]/,
  'CC0-1.0': /CC0 1\.0|Creative Commons Legal Code[\s\S]*CC0/,
  'Unlicense': /This is free and unencumbered software/,
};
const FORBIDDEN_LICENSE = /^(A?GPL|LGPL)-|^CC-BY(-[A-Z]+)*-(NC|SA)\b|-NC-|-SA-/;
/** Text a GPL notice or Shadertoy's default license always holds. */
const FORBIDDEN_TEXT = /GNU (Lesser |Affero )?General Public License|Attribution-NonCommercial-ShareAlike 3\.0|creativecommons\.org\/licenses\/by-nc-sa\/3\.0/i;
const SHADER = /\.(wgsl|metal|glsl|hlsl|frag|vert|comp)$/;

const abs = (p: string): string => (isAbsolute(p) ? p : join(REPO, p));
function portProblems(op: string, port: Ported): string[] {
  const at = `${op}: the port from ${port.from}`;
  const problems: string[] = [];
  if (FORBIDDEN_LICENSE.test(port.license)) problems.push(`${at} is under ${port.license}, a GPL or NonCommercial/ShareAlike license`);
  if (/shadertoy\.com/i.test(port.from) && /^CC-BY-NC-SA-3\.0/.test(port.license)) problems.push(`${at} is under Shadertoy's default license`);
  if (!LICENSE_TEXT[port.license]) problems.push(`${at} names ${port.license}, not a permissive license this check can confirm`);
  if (port.files.length === 0) problems.push(`${at} lists no shader file`);
  if (!existsSync(abs(port.notice))) { problems.push(`${at}: its notice ${port.notice} isn't in the checkout`); return problems; }
  const notice = readFileSync(abs(port.notice), 'utf8');
  if (LICENSE_TEXT[port.license] && !LICENSE_TEXT[port.license]!.test(notice)) problems.push(`${at}: its notice ${port.notice} doesn't hold the ${port.license} text`);
  if (FORBIDDEN_TEXT.test(notice)) problems.push(`${at}: its notice ${port.notice} holds GPL or Shadertoy-default license text`);
  for (const file of port.files) {
    if (!existsSync(abs(file))) { problems.push(`${at}: its shader ${file} isn't in the checkout`); continue; }
    if (dirname(abs(file)) !== dirname(abs(port.notice))) problems.push(`${at}: its notice ${port.notice} isn't beside its shader ${file}`);
    const head = readFileSync(abs(file), 'utf8').split('\n').slice(0, 40).join('\n');
    if (!head.includes(port.from) || !head.includes(port.license)) problems.push(`${at}: its shader ${file} doesn't name its source and ${port.license} in its header`);
  }
  return problems;
}
const listingProblems = (ops: Operator[]): string[] => ops.flatMap((o) => o.ported.map((p) => portProblems(o.name, p)).flat());

function shaderFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (['target', 'node_modules', '.git', 'vendor'].includes(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (SHADER.test(name)) files.push(path);
    }
  };
  for (const top of ['crates', 'packages']) if (existsSync(join(REPO, top))) walk(join(REPO, top));
  return files;
}
function scanProblems(files: string[], ops: Operator[]): string[] {
  const listed = new Set(ops.flatMap((o) => o.ported.flatMap((p) => p.files.map(abs))));
  const problems: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const name = relative(REPO, f);
    if (FORBIDDEN_TEXT.test(text)) problems.push(`${name} holds GPL or Shadertoy-default license text`);
    if (/shadertoy\.com/i.test(text) && !listed.has(f)) problems.push(`${name} names a Shadertoy source but no operator lists it as ported`);
    for (const notice of readdirSync(dirname(f)).filter((n) => /^(LICENSE|NOTICE|COPYING)/i.test(n) || /\.LICENSE$/i.test(n))) {
      if (FORBIDDEN_TEXT.test(readFileSync(join(dirname(f), notice), 'utf8'))) problems.push(`${relative(REPO, join(dirname(f), notice))}, beside ${name}, holds GPL or Shadertoy-default license text`);
    }
  }
  return problems;
}

describe('#380.993f9e93 every ported shader keeps its license beside it, and none comes from a GPL source or under Shadertoy\'s default license', () => {
  it('#380.993f9e93 the shipped operators list the shaders they port, each with its license beside it and named in its header, none under a GPL or Shadertoy\'s default license; the check fails each planted twin, naming it', () => {
    const ops = operatorsReply(run1(bins.bin(), out(), OPERATORS));
    shippedEffects(ops, 'the operators call');
    const shipped = ops.filter((o) => o.origin === 'shipped');
    console.log(`ported shaders: ${shipped.flatMap((o) => o.ported.map((p) => `${o.name}: ${p.files.join(', ')} from ${p.from} (${p.license}, ${p.notice})`)).join('; ') || 'none'}`);
    expect(listingProblems(shipped), 'the shipped operators\' ported shaders').toEqual([]);
    // The check's own twins, on files written for them.
    const dir = join(out(), 'port'); mkdirSync(join(dir, 'elsewhere'), { recursive: true });
    const from = 'https://www.shadertoy.com/view/XXXXXX';
    writeFileSync(join(dir, 'blur.wgsl'), `// Ported from ${from}, MIT\nfn f() {}\n`);
    writeFileSync(join(dir, 'blur.LICENSE'), 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n');
    writeFileSync(join(dir, 'elsewhere', 'blur.LICENSE'), 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n');
    const good: Ported = { files: [join(dir, 'blur.wgsl')], from, license: 'MIT', notice: join(dir, 'blur.LICENSE') };
    expect(portProblems('twin@1', good), 'the twins\' clean port passes the check').toEqual([]);
    expect(portProblems('twin@1', { ...good, license: 'GPL-3.0-or-later' }).join('\n'), 'a GPL port fails, named').toMatch(/twin@1: the port from .* is under GPL-3\.0-or-later/);
    expect(portProblems('twin@1', { ...good, license: 'CC-BY-NC-SA-3.0' }).join('\n'), 'a Shadertoy port under its default license fails, named').toMatch(/Shadertoy's default license/);
    expect(portProblems('twin@1', { ...good, notice: join(dir, 'missing.LICENSE') }).join('\n'), 'a port with no notice fails, named').toMatch(/its notice .*missing\.LICENSE isn't in the checkout/);
    expect(portProblems('twin@1', { ...good, notice: join(dir, 'elsewhere', 'blur.LICENSE') }).join('\n'), 'a notice in another folder fails, named').toMatch(/isn't beside its shader .*blur\.wgsl/);
  }, 1_800_000);

  it('#380.993f9e93 no shader source in the checkout holds GPL or Shadertoy-default license text, and every Shadertoy source is a listed port; the scan fails a planted GPL shader, naming it', () => {
    const ops = operatorsReply(run1(bins.bin(), out(), OPERATORS));
    const files = shaderFiles();
    expect(files.length, 'the scan finds the checkout\'s shader sources').toBeGreaterThan(0);
    expect(scanProblems(files, ops), 'the checkout\'s shader sources and the notices beside them').toEqual([]);
    const planted = join(out(), 'planted.wgsl');
    writeFileSync(planted, '// This program is free software: you can redistribute it under the terms of the GNU General Public License\nfn f() {}\n');
    expect(scanProblems([...files, planted], ops).join('\n'), 'a planted shader with GPL text fails, named').toMatch(/planted\.wgsl holds GPL/);
  }, 1_800_000);
});
