# 0015: The table import tool and the launchd hub benchmark

Status: accepted (#3715). The table tool's card is `packages/jobs/import/README.md` and its design is Asset job: imports (`docs/canvas-primitives.md`); the benchmark's surface is `tests/acceptance/3438/README.md`. The decisions below are the ones written in none of them.

## Delimited text

- **Rows split on the file's bytes, before any decoding.** `packages/jobs/import/table/text.mjs`, `Rows`. The delimiter, the quote and the row end are ASCII, so one reader splits UTF-8, Latin-1 and Windows-1252 alike. The quoting rule is the one #397's table probe reads CSV by (`crates/deep-catalog/src/cells.rs`), for all three delimiters: a row ends at LF, a CR before it outside the cell; a cell quoted from its first byte runs to a `"` not followed by `"`, `""` its quote, and the bytes after its closing quote up to the delimiter are no part of it; a blank line is no row (#3570).
- **The last row needs no LF.** `packages/jobs/import/table/text.mjs`, `Rows.end`. Its cell closes at the end of the file, as the probe's reader closes it.
- **A row past 16 MB is read to its end and refused there.** `packages/jobs/import/table/text.mjs`, `ROW_MAX`, `Rows.keep`, `Rows.rowEnd`. A longer row can't be a row of a table under its 16 MB cap, and a stream with no row end is held only to the row's own bound.
- **A run of blank lines is passed by at once.** `packages/jobs/import/table/text.mjs`, `Rows.push`. A file of line ends then reads at the speed of its bytes. In an unquoted cell the next row end and the next delimiter are both found natively, the row end once a chunk and the delimiter before it.
- **A chunk that may hold bytes its encoding doesn't turns on the per-cell check.** `packages/jobs/import/table/table.mjs`, `checker`, `delimited`. Once on, the strict pass checks every cell of a row, kept or not, so no row holds bytes the encoding doesn't.

## JSON lines

- **Each line is one object, and a value comes in as its text.** `packages/jobs/import/table/table.mjs`, `jsonLines`. A row is its line in the file, 1 the first, and a column comes from a key. A string comes in as it is, a number or a boolean as JSON writes it, a null or a key the line leaves out as missing, and an object or a list refuses the row. The keys stand in for a header the cut places once.

## The streamed request

- **The params resolve before the file's first byte.** `packages/jobs/import/table/table.mjs`, `request`. When the file's value begins, the request so far, closed, holds the params. The value's closing quote is kept, so the rest of the request parses whole with the file's value empty.
- **At most a few decoded pieces wait for the reader.** `packages/jobs/import/table/table.mjs`, `request`, `push`. The request is read no faster than the import takes it.
- **A request with no file input, or a file given as something else, hands on nothing.** `packages/jobs/import/table/table.mjs`, `request`.
- **After a refusal the rest of the request is read and dropped.** `packages/jobs/import/table/table.mjs`, `main`. The host's write then ends.

## Archives and workbooks

- **A backslash in a path leaves the archive's root.** `packages/jobs/import/table/zip.mjs`, `leaves`. A reader may split on it; an absolute path, a drive and a `..` segment leave it too.
- **An entry that isn't named, of known size, is passed by unread.** `packages/jobs/import/table/zip.mjs`, `ZipMember.body`. Where an entry's sizes come after its data, the deflate stream says where it ends and its descriptor follows. A member's unpacked bytes are counted on the stream as it inflates, never taken from a header.
- **A workbook is read by the archive's central directory, and only the parts the sheet needs.** `packages/jobs/import/table/xlsx.mjs`, `entries`, `part`, `sheetRows`. Those are the workbook, its relationships, its shared strings and styles, and the named sheet. Macros, links to other files and embedded objects are parts this reader never opens (#3570).
- **A string item's text leaves out its phonetic runs.** `packages/jobs/import/table/xlsx.mjs`, `textOf`.
- **A date serial allows for the 1900 system's leap day.** `packages/jobs/import/table/xlsx.mjs`, `iso`. The 1900 system counts a 29 February 1900 that never was: serials from 61 on are a day later than their count. A serial with no time of day is written as a date alone.

## The import kind

- **The workbook fixture is the acceptance suite's `sum.xlsx`, byte for byte.** `packages/jobs/import/index.ts`, `table`, `FIXTURES` (#3570).

## The launchd hub benchmark

- **A run ends itself at 270 s.** `benchmarks/hub-launchd.mjs`, `late`. A budget run gets 300 s (`measureOnce`).
- **A pair's spin on the Background hub runs beside its other two spins.** `benchmarks/hub-launchd.mjs`, `commands`. It has a core of its own, so a run fits its 300 s. A pair's writes take turns on the one disk.
- **The spin is sized by a run of its own.** `benchmarks/hub-launchd.mjs`, `commands`; the `spin size` mode. It is the iterations one core does in `SPIN_MS`, and a twentieth more, counted from the benchmark's own process.
- **A run first boots out each label an earlier run left loaded whose process is gone.** `benchmarks/hub-launchd.mjs`, `sweep`. A run stopped by SIGKILL removes nothing.
- **A run waits for its hubs to end, 10 s at most, before it removes their homes.** `benchmarks/hub-launchd.mjs`, `ended`. None then writes into a home that is being removed.
- **The sides reading is the design's regression rule, with the child-started hub in the merge base's place.** `benchmarks/hub-launchd.mjs`, `JUDGES.sides`. The limit reading is the five-run rule (`scripts/benchmark.mjs`, `judgeLimit`) on the report's own machine and loads.
- **The launcher leaves a loaded label alone.** `benchmarks/hub-launchd.mjs`, the `load` mode. It is `deep hub start`'s launcher: it loads the definition `deep hub start` wrote under the run's label.
- **With `absent` after the mode, the hub is loaded with no ProcessType.** `benchmarks/hub-launchd.mjs`, `loadedHub`. The readings are for the other column, and the judge never passes them (#3438).
- **The sample sizes.** `benchmarks/hub-launchd.mjs`. A round-trip sample is 1,000 PreToolUse requests, one connection each; hook-overhead reads `deep-hook.mjs overhead` five times; idle reads the hub's CPU over 5 s, five times, once it has settled.

## What the names mean

- **`Cut.row(n, count, text, formula)`.** `packages/jobs/import/table/cut.mjs`, `Cut`. Rows are fed in the file's order: `n` is the row's place in the file, 1 the first, `count` its cells, and `text(i)` cell i's text, null where the file holds no value; it refuses where the bytes aren't valid in the encoding. A row before the header is none of the table's, the header gives the columns' places, and a row after it is a data row. `done()` writes `{table, receipt}`.
- **`parse(text, dtype, group)`.** `packages/jobs/import/table/cut.mjs`, `parse`. It gives a number's text, or undefined where it doesn't parse as `dtype`: an integer in i64's range, or a finite f64 written in its shortest form, −0 as 0. With `group`, the integer part may group its digits by threes with that mark.
- **`TABLE_MAX`.** `packages/jobs/import/table/cut.mjs`, `TABLE_MAX`. The table probe's cap (Asset: tables; `MAX_BYTES` in `crates/deep-codecs/src/table.rs`).
- **`tableProbe(bytes)`.** `packages/jobs/import/table/probe.mjs`, `tableProbe`. It says what is wrong with a table's bytes, in words, or gives undefined when they read as a table.
- **`Rows`.** `packages/jobs/import/table/text.mjs`, `Rows`. `push(chunk)` hands each row it ends to `row(cells, n)`, `n` its 1-based row in the file and each cell a Buffer of its bytes, with a quoted cell's `""` read as `"`; `end()` hands on the last. Its `state` is 0 at a cell's start, 1 in an unquoted cell, 2 in a quoted one, 3 just after a `"` in one, and 4 past its closing quote. A byte order mark at the file's start is dropped (`bomless`).
- **`CP1252`.** `packages/jobs/import/table/text.mjs`, `CP1252`. Windows-1252's bytes 0x80 to 0x9F, 0 where the code page leaves a byte undefined. `decode` gives a cell's text in the declared encoding, or undefined where its bytes aren't valid in it.
- **`importTable(given, chunks)`.** `packages/jobs/import/table/table.mjs`, `importTable`. `chunks` is an async iterable of Buffers, and the answer is `{table, receipt}`. A refusal throws an Error carrying `refusal: {code, …}`, and nothing is written. `specOf` gives a spec with its defaults written out, or a refusal naming the field that is wrong.
- **`refusal(code, why, detail)`.** `packages/jobs/import/table/zip.mjs`, `refusal`. `code` is the kind of thing refused and `detail` the thing.
- **`ZipMember`.** `packages/jobs/import/table/zip.mjs`, `ZipMember`. `push(chunk)` as the chunks come, then `end()`. The member at `member` is handed to `sink.data(chunk)` as it inflates and `sink.end()` after it; `end()` resolves to `{path, sha256, bytes}`, and a refusal rejects `push` or `end` with an Error carrying `refusal`. `first` is the planted reader of #3570's qualification, which takes the archive's first member whatever `member` says. `entry` is the entry being passed, undefined between entries.
- **`ZipMember.inflate(e, part, last)`.** `packages/jobs/import/table/zip.mjs`, `ZipMember.inflate`. `last` says the part is the stream's known end. It resolves to how many of the part's bytes the stream used: all of them until it ends, and those up to its end where the stream ends inside the part. A known end waits for the stream's end; a write, for its bytes to be taken and their output handed on.
- **`sheetRows(file, sheet, max, evaluate)`.** `packages/jobs/import/table/xlsx.mjs`, `sheetRows`. It gives the rows of one sheet by name, each `{n, cells}` with `n` its row in the sheet, 1 the first, and `cells` its values by column, each its stored text or null where the cell holds no value; and `formula(n, col)`, whether that cell holds a formula. `evaluate` is the planted reader of #3570's qualification, which evaluates each SUM over a range in place of the value the file stored.
- **`column(ref)`.** `packages/jobs/import/table/xlsx.mjs`, `column`. A cell reference's 0-based column: A is 0. `DATE_FORMATS` holds the built-in number formats that show a date or a time.
- **`loadedHub(dir, name, type, seed)`.** `benchmarks/hub-launchd.mjs`, `loadedHub`. `type` is the ProcessType the hub is loaded with: the build's when undefined, none when null.
- **`reading` and `notLaunchds`.** `benchmarks/hub-launchd.mjs`, `reading`, `notLaunchds`. Each gives why not, as a status and a reason, and undefined when there is nothing wrong: `reading`, why readings taken at `loads` on `machine` are readings and no budget result (#568); `notLaunchds`, why the hub a report names was not started by launchd under a label of the run's own from the definition with `type`.
- **`cpuOf(hub)` and `overhead(hub)`.** `benchmarks/hub-launchd.mjs`, `cpuOf`, `overhead`. `cpuOf` is the hub's CPU time so far, in seconds, as `ps` gives it; `overhead` is deep-hook's p95 over the native no-op's p95, in ms, over 1,000 forwarded PreToolUse calls to the hub.
