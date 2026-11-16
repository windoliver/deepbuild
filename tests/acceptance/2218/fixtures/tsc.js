// node_modules/typescript/bin/tsc of the twin's fixture repo (#2218 AC5): the fixture's typecheck, entered as this
// repo's spec enters TypeScript's, `node node_modules/typescript/bin/tsc --noEmit`. The fixture holds no TypeScript,
// so it finds nothing wrong and exits 0, as tsc does on a clean tree; any other call is refused.
if (!process.argv.slice(2).includes('--noEmit')) {
  console.error('the fixture typechecks only: pass --noEmit');
  process.exit(2);
}
process.exit(0);
