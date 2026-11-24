// #3035.a4b3d8f2: "A file that includes a macro is refused before anything is written, naming the element, and a mesh
// path outside the job's inputs is refused, naming the path"
//
// The fixtures (README: The fixtures and their numbers): fixtures/macro.urdf declares the macro namespace such files
// declare and holds one element of it, `xacro:include`, so the file is no robot until its macro is expanded;
// fixtures/mesh.urdf holds one link whose visual names the mesh `../elsewhere/shell.stl`, and the job is given the
// file alone, so the path is none of its inputs.
//
// Each run answers `{status: "refused", reason}` (README: The refusals): the reason holds the element's name as the
// file writes it, `xacro:include`, or the path as the file writes it. Nothing is written: the reply returns no
// output, and the hub's evidence store holds after the run exactly the files it held before. That comparison isn't
// vacuous: in the same hub a conversion that is done, of fixtures/arm.urdf, adds its document and its report to the
// same listing of the store.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, convert, fixture, kept, openHub, refusalFailures, runFile, type Hub } from './helpers.ts';
import { ARM } from './model.ts';

const ID = AC[5];
const MACRO = { file: 'macro.urdf', names: 'xacro:include' } as const;
const MESH = { file: 'mesh.urdf', names: '../elsewhere/shell.stl' } as const;

let hub: Promise<Hub | string> | undefined;
/** The file's one hub, for both tests. */
const opened = (): Promise<Hub | string> => (hub ??= openHub());

/** One refused run of a fixture, with the store before and after: everything wrong with it. */
async function refused(h: Hub, file: string, named: string): Promise<string[]> {
  const before = kept(h);
  const run = await runFile(h, file);
  return refusalFailures(run, named, before, kept(h));
}

describe(`${ID} a file the job can't convert whole is refused, naming what stops it`, () => {
  it(`${ID} a file that includes a macro is refused before anything is written, naming the element`, async () => {
    const text = fixture(MACRO.file);
    expect([text.includes(`<${MACRO.names} `), (text.match(/<xacro:/g) ?? []).length], `${MACRO.file} holds one element of the macro namespace, ${MACRO.names}`).toEqual([true, 1]);
    const h = await opened();
    expect(typeof h === 'string' ? h : '', 'a hub with the import plug-in, whose kind lists the tool that converts').toBe('');
    const failures = await refused(h as Hub, MACRO.file, MACRO.names);
    expect(failures, `the run of ${MACRO.file} is refused, naming ${MACRO.names}, with nothing written:\n  ${failures.join('\n  ')}`).toEqual([]);
    // The store's listing sees what a job writes: a conversion that is done adds its document and its report to it.
    const before = kept(h as Hub);
    const c = await convert(h, ARM.file);
    expect(typeof c === 'string' ? c : '', `in the same hub, deep_job converts ${ARM.file}`).toBe('');
    const outputs = (c as Exclude<typeof c, string>).outputs;
    const added = kept(h as Hub).filter((sha) => !before.includes(sha));
    expect([added.includes(outputs['document'] ?? ''), added.includes(outputs['report'] ?? '')], `the listing of the hub's evidence store gains the document and the report a conversion keeps: ${added.join(', ')}`).toEqual([true, true]);
  }, TIMEOUT);

  it(`${ID} a mesh path outside the job's inputs is refused, naming the path`, async () => {
    const text = fixture(MESH.file);
    expect([text.includes(`<mesh filename="${MESH.names}"/>`), (text.match(/<mesh /g) ?? []).length], `${MESH.file} names one mesh, by the path ${MESH.names}`).toEqual([true, 1]);
    const h = await opened();
    expect(typeof h === 'string' ? h : '', 'a hub with the import plug-in, whose kind lists the tool that converts').toBe('');
    const failures = await refused(h as Hub, MESH.file, MESH.names);
    expect(failures, `the run of ${MESH.file}, given no mesh, is refused, naming ${MESH.names}, with nothing written:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
