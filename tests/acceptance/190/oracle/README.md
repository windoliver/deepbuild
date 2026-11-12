# #190's oracle lane: upstream tests held to our output

Written by a blind job from issue #190 (live, `gh issue view 190 -R windoliver/deepbuild`), the oracle map for it
(`issues/190.md`, `cases/190.json`, `pins.json`), the three upstream files the map vendors for it, and base commit
`e7609b7b`, with AGENTS.md and `docs/technical-design.md` (the parity-suite paragraphs, "A CPU reference counts as
an oracle only once …", and Dogfooding), and #160's oracle lane at that commit as the model. No implementation of
#190 was seen: no file of `crates/deep-logic` or `crates/deep-canvas-sandbox` past the base, no other commit, no
evidence. The parent suite (`../`, written blind before the implementation) was read, and these tests reuse its
proof surface and tools unchanged (`../README.md`: The surface under test; `../helpers.ts`, `../libs.ts`,
`../programs.ts` and its assembler `../wat/`): `deep-logic`'s `check` and its receipt's `linked` (the merged module
before the rewrite), its refusals' naming fields, and its planted values. They add no option, call, field or planted
value.

The map's rule: a linked test counts as evidence only when a runner feeds it our output and it rejects our output
with a planted fault. wasm-ld isn't our linker, and upstream's tests run `llvm-mc`, `wasm-ld` and `obj2yaml`, none
of which is run here. Each test below instead builds upstream's case as our objects (a program and libraries, as
`../README.md`: Relocatable objects lays them out), links them through our `deep-logic`, and holds what upstream's
CHECK lines check to our output: the merged program's bytes, read by this lane's reader `wasm.ts` (upstream reads
its output with `obj2yaml`) and run by node's own WebAssembly, or our refusal. The table says which planted value,
or which twin, shows each test rejecting a wrong program.

## Run

```sh
npx vitest run --root tests/acceptance/190/oracle --no-file-parallelism
```

As the parent suite: each file builds `deep-logic` once (`cargo build --locked --bin deep-logic`) and the suite's
assembler (`../wat/`), and fails its tests if either doesn't build; every test passes the parent's timeout. Node
built-ins and vitest only. No host gate: these tests need neither the Mac, Docker nor Chrome. The files type-check
under the parent's `tsconfig.json` (`npx tsc -p tests/acceptance/190/tsconfig.json`, whose include picks up
`oracle/`), checked outside the repo, so no `tsconfig.json` is added. Vitest's default include also picks these
files up in the parent suite's own run (`--root tests/acceptance/190`); no parent file was changed. A run leaves
Vitest's cache in `oracle/node_modules/.vite`; delete it.

Files: `function-imports.test.ts`, `data-layout.test.ts`, `undefined.test.ts` (the tests); `wasm.ts` (a reader of a
module's sections, from the core specification's binary format: types, imports, functions, memories, exports, code
bodies, custom sections by name); `objects.ts` (this lane's program objects, with the parent's head and its `v`
write, and node's run of a merged program); `vendor/` (the upstream files, unchanged; `vendor/NOTICE.md`).

## Criteria to tests

IDs are the parent suite's (`../helpers.ts`: AC). 6 tests.

| ID (map) | Upstream | Tests | Wrong program shown failing |
|---|---|---|---|
| 1 `#190.e0980599` (1) | llvm-project `lld/test/wasm/function-imports.s` (run on our code) | `function-imports.test.ts` (2): ret32@1 (ret32: (f32) -> (i32)) linked into a program whose internal `$start: () -> ()` has _start's body; held from upstream's CHECKs: our merged program imports nothing (FUNCTION directly after TYPE), its types hold (f32) -> (i32) and () -> (), exactly one defined function has type (f32) -> (i32); our own: it keeps no `linking` or `reloc.*` section, exactly one () -> () function has _start's body and its call goes to that function, and run in node the call returns ret32's 32 | `linker_adds_linking_section`: its merged program keeps a `linking` section, which only our own no-`linking` check catches (no upstream-held check does; see below); the twin of a linker that resolves nothing (the program object as written) fails the upstream-held "imports nothing", naming `lib:ret32.ret32`, and our own check that _start calls an internal function |
| 1 `#190.e0980599` (1) | llvm-project `lld/test/wasm/data-layout.s` (run on our code) | `data-layout.test.ts` (2): a program with 8,195 data bytes linking alpha@1 ("ALPHA") and beta@1 ("BETA!!!"), listed beta first; the receipt names alpha@1 then beta@1; the merged program has one defined memory, 1 page minimum and maximum, exported as `memory`; instantiated, its memory holds the program's bytes at 0, "ALPHA" at 8,200 and "BETA!!!" at 8,208 (each at alignment 8 after the one before) and zeros elsewhere; run, each library reads its own data through its relocated address (v = 65,033) | `linker_links_in_listing_order`: it lays beta@1 out first, and the layout check fails naming alpha@1's address, 8,200 |
| 3 `#190.ea25cdd0` (3) | llvm-project `lld/test/wasm/undefined.s` (run on our code) | `undefined.test.ts` (2): a program importing `lib:turns.next_turn` and `lib:grid_path.find_route`, linking only turns@1, is `link_refused` naming the item, a refusal naming `lib:grid_path.find_route` (CHECK) and, a check of our own in place of the CHECK-NOT (not held), none naming `lib:turns.next_turn`, which turns@1 defines; the twin linking turns@1 and grid_path@1 is admitted, imports nothing and, run, returns next_turn(0, 3) + the open grid's 4 moves | none: no planted value reaches an import no listed library exports; the wrong program is the base, which refuses every item with `links` without naming an import (`BASE-FAILURE.txt`). The twin fails a linker that refuses any program importing from two libraries |

Criteria 2 and 4–10 have no upstream test in the map (its "No upstream test" table); the parent suite proves them.
Criterion 3's other refusals (hash mismatch, a pack's other hash, a library importing a later one, 4 MiB) have no
upstream test either, per the map.

## What could not be held to our output, and why

- **function-imports.s against the planted linker.** Upstream's CHECKs read no custom section's name but `name`: a
  `linking` section before `name` passes them, and one after it fails only their final CHECK-NEXT `...` (nothing
  after the name section's function names). Our merged program has no name section (`../README.md` gives it none),
  so that line can't be held, and `linker_adds_linking_section`'s empty `linking` section is caught only by the
  test's own check that no `linking` or `reloc.*` section is left. Every upstream-held check (no imports, both
  types, one defined (f32) -> (i32)) passes on the planted output; for function-imports.s, the planted value shows
  only our own check failing, and the upstream-held ones are shown failing only on the unlinked-object twin.

- **function-imports.s: function order and type count.** Upstream expects `FunctionTypes: [ 0, 1 ]` (ret32 first,
  the input order) and exactly two signatures (wasm-ld merges equal ones). Our program must also define logic@1's
  init and step ((i64) -> ()), and `../README.md` fixes neither the merged module's function order nor whether its
  linker merges equal types, so the test holds that both signatures are there and which function has which, not
  their indices or the count.
- **function-imports.s: the name section** (`FunctionNames`: ret32, _start). `../README.md` gives a merged program
  no name section (its objects have none) and no other field exposes a library function's name in a merged program
  (a trap's `library.function` does, which the parent's criterion 5 test holds), so the names aren't checked.
- **function-imports.s: `Inputs/ret32.s`** isn't vendored (the map copies only function-imports.s). The test needs
  only ret32's signature, which function-imports.s declares (`.functype ret32 (f32) -> (i32)`); our ret32@1 has that
  signature and returns 32, a body of ours, so a run shows the call reaching it.
- **data-layout.s: wasm-ld's own layout.** Its addresses (65536 onward, after a 64 KiB stack), segments merged by
  section name (.rodata, .data, .bss), the linker-made globals (`__data_end`, `__heap_base`, `__rodata_start`/`end`),
  wasm64, `--no-growable-memory` and shared memory aren't our linker's: ours places the program's data at its own
  offsets from 0 and each library's after it in link order (`../README.md`: The linker's layout), with no globals of
  its own, a wasm32 memory of the program's fixed size. The test holds what carries over: one memory with the limits
  given (upstream's CHECK-MAX: maximum = minimum) and each object's data in link order at its alignment. Upstream's
  live CHECKs don't read `external_ref`'s value (they stop at the second segment's offset, and its relocation is only
  in the disabled XUN/RELOC block); the test's check that a library's address resolves to where its data landed is
  our own, standing in for it.
- **data-layout.s: relocations inside data** (`external_ref: .int32 hello_str`, R_WASM_MEMORY_ADDR_I32) and its
  `--relocatable` checks (XUN, disabled upstream). Our objects relocate addresses in code only (`../README.md`:
  Relocatable objects), so the resolved address is checked through a library's code reading its data, and
  `Inputs/hello.s` (not vendored) isn't needed.
- **undefined.s: `--allow-undefined`, `--allow-undefined-file`, `--export=xxx` and `--undefined=baz`.** Our linker
  has no such options and must never leave an import (the issue: "It can never: Leave an import in the running
  program"). So the CHECK-NOT, that a symbol only `--undefined` names, which nothing references (`baz`), isn't reported,
  isn't held: no such symbol can arise in our links. In its place the test checks something of our own, that no
  refusal names an import a listed library defines (`lib:turns.next_turn`). Upstream's passing runs are held as the
  twin that links once the symbol is defined.
- **undefined.s: a symbol reached through its address in data** (`.int32 foo`). Our objects take no function's
  address (no table, element segment or `ref.func`), so the undefined symbol is reached by a call.

## Readings where the inputs leave a choice

1. **"Our output" for a link** is the receipt's `linked.bytes`, the merged module before the rewrite: what
   `../README.md` says the subset check, the rewrite and bakes see. So under `linker_adds_linking_section` ("adds an
   empty `linking` custom section to the module it gives the subset check and the rewrite") the empty section is in
   `linked`, and a module with a `linking` or `reloc.*` section is an object, not a linked program.
2. **Link order** for libraries that need nothing is by name (`../README.md`: Linking, "ties broken by name"), so
   listing beta@1 before alpha@1 makes link order differ from listing order, which `linker_links_in_listing_order`
   follows instead.
3. **"After the one before"**: alpha@1's data starts at the program's data end (8,195) rounded up to the objects'
   segment alignment 8, beta@1's at alpha@1's end (8,205) rounded up the same way; any byte outside the three
   objects' data is zero, since a merged program here holds no data of the linker's own.
4. **Naming the symbol**: our refusal's `import` field (`{module, name}`, read by the parent's `importOf`) is
   upstream's "undefined symbol: foo"; `item` is upstream's object file name. Free text (`rule`, `what`) is never
   compared, as in the parent suite.

## The checks against a real linker

Before the base run, each check was held to LLVM's own linker on the same objects (a temporary test outside the repo,
deleted): rust-lld 1.99.1's `wasm-ld` with `--no-entry --global-base=0 --stack-first -z stack-size=0
--no-gc-sections --initial-memory=65536 --max-memory=65536` (the parent README's flags, which place the program's
data at 0 and each library's after it, in input order). Its merged ret32 program passes every function-imports
check and runs to 32; the program object unlinked fails four (imports left, `linking` and `reloc.CODE` left, no
defined (f32) -> (i32), _start calling an import). Its alpha-then-beta program passes every data-layout check and
runs to 65,033; linked beta first it fails three (alpha@1's and beta@1's data at the wrong addresses, a stray byte
at 8,205) and still runs to 65,033, so the layout, not the run, is what tells link order. The undefined program
with only turns@1 is refused by wasm-ld as "undefined symbol: find_route" and nothing else; with grid_path@1 too it
links and runs to 5. Not checked: anything through our own linker (this job may not see it).

## Base failure

`BASE-FAILURE.txt`: all 6 tests fail at the base `e7609b7b`: four on its refusal of `links` ("links isn't built yet
in logic@1"), so no merged program is read and no `link_refused` given, and two on `--planted`, which the base
answers with `bad_input`. Every object these tests write assembled first.
