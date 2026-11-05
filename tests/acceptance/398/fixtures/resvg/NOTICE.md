# resvg test files

The files under this folder come from resvg (https://github.com/linebender/resvg) at commit
`77b12f4951a7b75d759c42e8c9497cff7c839c3c`, as pinned by the Oracle page for issue #398
(`doneright/oracles/issues/398.md`):

- `structure/use/*`, `structure/defs/*`, `painting/color/*` (AC5) and `masking/clipPath/*`, `masking/mask/*`,
  `paint-servers/pattern/*`, `painting/marker/*`, `structure/style/*`, `shapes/rect/*` (AC6): copied unchanged, each
  SVG with its reviewed PNG, from `crates/resvg/tests/tests/<same path>`. The AC6 folders came to this job from the
  oracles repo's vendored copy (`doneright/oracles/vendor/…`) at the same commit.
- `usvg-parser/*.svg`: the SVG strings of two tests in `crates/usvg/tests/parser.rs`
  (`use_node_abs_transform`, `path_transform_nested`), written out as files; `path_transform_nested` gains the
  ids `g1` and `path1` and `use_node_abs_transform` the id `use1` so the import names them as parts. The expected
  boxes are the tests' own assertions (see `parts.test.ts`).

Copyright the Resvg Authors. resvg is dual-licensed under the Apache License, Version 2.0 or the MIT license, at
your option (`SPDX-License-Identifier: Apache-2.0 OR MIT`, as each of its source files states). These copies are
used under the MIT license, whose text follows.

    MIT License

    Copyright (c) the Resvg Authors

    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
    documentation files (the "Software"), to deal in the Software without restriction, including without
    limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
    Software, and to permit persons to whom the Software is furnished to do so, subject to the following
    conditions:

    The above copyright notice and this permission notice shall be included in all copies or substantial
    portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
    TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
    THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
    CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
    DEALINGS IN THE SOFTWARE.
