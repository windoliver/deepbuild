# #1898's planted wrong programs

Commit 35bb7eaba (#1951) already put `DISK_FLOOR` and `freeBytes` in `packages/hub/src/disk.ts`, and since c332f7fb0
(#2332) the hub reaches the check kits only through dynamic imports, so a kit loads the first time something uses it
(a judged claim, a `checks.kinds` call, a command run, a review round, the rules page), never at the start. Both are on
the merge base, so this suite's tests pass there.
Each test is proven instead by a wrong program, each a whole copy of the merge base's file with the marked lines
changed:

- `lease-loads-products`: `packages/hub/src/heavy.ts`, the `./lease` entry, with a side-effect
  `import './products.js'`. Its static closure reaches `yaml.js` → `node_modules/yaml` and `vfs.js` →
  `better-sqlite3`, so `lease-closure.test.ts` fails at its last `expect`, naming both chains (#1898.ff1558c5).
  `deep lease` then loads better-sqlite3 and `@deepbuild/contracts`'s index (`yaml.ts` requires `yaml` only when
  it parses), so `packages/cli/test/loads.test.ts` fails, and with it the first
  `no-visible-change.test.ts` test at its `notPassed` `expect` (#1898.6f3b1f79).
- `kit-at-start`: `packages/hub/src/kinds.ts` with a static `import '@deepbuild/checks-review'`. `hub-runtime.ts`
  imports `kinds.js` statically, so the hub's core thread loads the review kit at its start, and
  `hub-start.test.ts` fails at its kit-modules `expect` (#1898.83fded9a).
- `cli-type-error`: `packages/cli/src/update-check.ts` with a `string` assigned to a `number`, and
  `packages/cli/package.json` with its build script's exit masked (`tsc -p tsconfig.json || true`). The proof lane
  builds a twin's checkout with `npm run build --workspaces`, and a failed build leaves it unrunnable, so the mask keeps
  the build at exit 0 (tsc still emits) while `tsc -p packages/cli/tsconfig.json --noEmit` exits 2. The second
  `no-visible-change.test.ts` test fails at its `expect` on the failed type-checks (#1898.6f3b1f79). Checked by hand on
  Nov 20, 2026: the masked build exited 0 and tsc exited 2 with `TS2322` at `src/update-check.ts(6,7)`.

The suite's `tsconfig.json` includes `./**/*.ts`, so it also takes in these twins, whose relative imports resolve only
at their repo path; `tsc -p tests/acceptance/1898` reports them. No lane runs that tsconfig, and the suite's tsconfig is
the blind job's, so it is left as it is.
