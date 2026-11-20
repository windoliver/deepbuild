# deep-catalog

## What it is for

The data module's catalog probe (issue #194; canvas primitives: Asset: tables: catalogs `table.layout@1`): a game's content tables, CSV or JSON lines, and their schema packed into the one documented columnar layout that a logic item, keyed copy and the catalog plug-in's checks all read by hash. Inheritance resolves first and a cycle is refused; IDs, table names and column names hash by FNV-1a and a collision is refused, naming both; rows sort by their ID's hash; a ref to an ID no row holds packs as 0xFFFFFFFF and is listed in the record beside the bytes. The decode worker runs it as its `catalog` job; `deep-catalog pack` runs the same code alone, its proof surface.

## Where new code goes

- `src/lib.rs`: the schema, typed cells, inheritance, the pack and its record, the refusals and the planted packers.
- `src/cells.rs`: the one CSV reader, which deep-codecs' table probe (#397) uses too, and JSON lines.
- `src/read.rs`: reading packed bytes by hash, as a logic program does; logic.tuning moves a tuning row with it.
- `src/main.rs`: `deep-catalog pack`, JSON lines in and out.
- Tests sit in `src/tests.rs`; the acceptance tests are in `tests/acceptance/194`.

## What it may import

serde_json and sha2 only, so its bytes build the same for every target. It never reads a clock or the network; only the bin reads the files a line names.

## Deviations

None.
