// The #537 Oracle lane's tools: the #537 suite's surface (`deep-gpu run`'s `view3d` with a logic item's arrays feeding an
// instancer, `evaluate`'s `items/<instancer>/elements` and each frame's `selection`, ../537/helpers.ts) and its program
// writer (../537/programs.ts), reused as they stand so both lanes ask the same program the same way.
export * from '../537/helpers.ts';
export { poolProgram } from '../537/programs.ts';
