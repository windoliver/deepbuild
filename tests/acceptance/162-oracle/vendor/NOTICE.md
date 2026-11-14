# Upstream files in this folder

Copied unchanged, at the commits the #162 oracle map pins, under the paths they have upstream (each file's bytes were
checked against the upstream blob at its commit). Only the files the tests beside this folder read at run time are
here, with each project's own licence file. No GPL file is copied.

| Folder | Project | Commit | Licence | Upstream |
|---|---|---|---|---|
| `lottie-spec-4b55957472/` | lottie/lottie-spec | `4b55957472f8718e34e9c1298f0e8f021b6c597f` | Community Specification License 1.0 (the specification), MIT (code); `License.md` | https://github.com/lottie/lottie-spec/tree/4b55957472f8718e34e9c1298f0e8f021b6c597f |
| `lottie-web-bede03d25d/` | airbnb/lottie-web (the upstream renderer) | `bede03d25d232826e0c9dca1733d542d8a7754fb` | MIT; `LICENSE.md` | https://github.com/airbnb/lottie-web/tree/bede03d25d232826e0c9dca1733d542d8a7754fb |

The files, and how the tests use them:

- lottie-spec `tests/validate_animations.test.js` (the upstream test: ported in `../helpers.ts`, `validate` and
  `upstreamVerdicts`, and not run as it is, since it needs the spec's built `docs/lottie.schema.json`, which its
  repository doesn't hold); `schema/` (its parts, merged at run time as the spec's build merges them);
  `tests/animations/valid/` and `tests/animations/invalid/` (the port's own check, read by `schema.test.ts`);
  `docs/static/examples/` (the 20 examples: `schema.test.ts`, `examples.test.ts`, and `trim_path.json` and
  `matte.json` for `corpus.test.ts`).
- The upstream renderer's `test/animations/adrock.json`, `banner.json` and `lights.json` (read by `corpus.test.ts`: merge
  paths, text layers, expressions and a position on spatial tangents). Its other corpus files are not needed by any
  test here and are not copied.

`validate_animations.test.js` keeps its upstream name, so a vitest run of this whole folder would collect it: run this
suite one file at a time, as its README says.
