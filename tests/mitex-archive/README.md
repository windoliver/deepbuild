# MiTeX archive migration proof (#2359)

`expected.json` is the complete command map decoded by **unmodified mitex-spec 0.2.7** at `51f7210e026ab05d037125247e92d4d023d8a80d`, from that pin's `mitex-spec-gen/assets/artifacts/spec/default.rkyv` (artifacts submodule `9eb762afa001b36205408c7615a73e5dfaa6f80a`). It is not generated from the new reader. The original archive's SHA-256 is recorded in `vendor/mitex-spec-gen/assets/default.rs`. The map retains MiTeX's Apache-2.0 license (`vendor/mitex-spec/LICENSE`).

The test reads the exact bytes included by the shipping spec generator, decodes them through the vendored public API, and compares every command/alias/argument shape/environment with that map. A missing command is rejected too. The original decoder is deliberately not a dependency of this test: the old vulnerable rkyv version belongs only to the one-time migration environment, never a repository lock or shipped runtime.

Run `node --test tests/mitex-archive.test.mjs` with the installed toolchain and cached dependencies. Missing bytes, an invalid archive or failed Cargo execution fails; no fallback. Reuse #220's unchanged document/SVG tests for rendering behavior. This value comparison is not an exploit test.
