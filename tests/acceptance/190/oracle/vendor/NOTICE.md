# Upstream files in this folder

Copied unchanged, at the commit the oracle map pins (`pins.json`), under the paths they have upstream. Only the
files the tests beside this folder translate are here; nothing in this folder is run (the tests don't call
`llvm-mc`, `wasm-ld` or `obj2yaml`). The license is the project's own, as `pins.json` records it.

| Folder | Project | Commit | License | Upstream |
|---|---|---|---|---|
| `llvm-project-0d261d1ca5/` | llvm/llvm-project (llvmorg-23.1.3) | `0d261d1ca552c95a8f007e061c787ac7132fbcbc` | Apache-2.0 WITH LLVM-exception | https://github.com/llvm/llvm-project/tree/0d261d1ca552c95a8f007e061c787ac7132fbcbc |

The files, and how the tests use them:

- `lld/test/wasm/function-imports.s`
  ([upstream](https://github.com/llvm/llvm-project/blob/0d261d1ca552c95a8f007e061c787ac7132fbcbc/lld/test/wasm/function-imports.s)):
  its objects and CHECK lines, translated by `function-imports.test.ts`. Its other input, `%p/Inputs/ret32.s`, is
  not vendored (the map doesn't copy it); the test needs only its signature, which function-imports.s declares
  (`.functype ret32 (f32) -> (i32)`), so our ret32@1 has that signature and a body of our own.
- `lld/test/wasm/data-layout.s`
  ([upstream](https://github.com/llvm/llvm-project/blob/0d261d1ca552c95a8f007e061c787ac7132fbcbc/lld/test/wasm/data-layout.s)):
  its MEMORY and DATA checks, translated by `data-layout.test.ts`. Its other input, `%p/Inputs/hello.s`, is not
  vendored; the test reads only what data-layout.s's own CHECK lines show of it (a string whose address another
  object's data takes).
- `lld/test/wasm/undefined.s`
  ([upstream](https://github.com/llvm/llvm-project/blob/0d261d1ca552c95a8f007e061c787ac7132fbcbc/lld/test/wasm/undefined.s)):
  its failing run's CHECK and CHECK-NOT, and its passing runs, translated by `undefined.test.ts`.
