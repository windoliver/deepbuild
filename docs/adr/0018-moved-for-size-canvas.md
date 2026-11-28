# 0018: What the canvas code moved for size said in comments

Status: accepted (#3650, #3669). The size ratchet's fix moves one named concept to a file of its own, and a new file starts with no comments (0001). Each note below is what a comment on the moved code said, word for word where it is a decision, with the file and the symbol it now governs. Nothing here is a new decision.

## deep-show

- **A JSON number past f64's range is read as a marker, not a parse failure.** `crates/deep-show/src/overflow.rs`, `OVERFLOW` and `tame_overflow`. `OVERFLOW` is the marker such a number is read as, so the document check can refuse it with `out_of_range` at its path instead of the whole line failing to parse. `tame_overflow` gives a line whose numbers past f64's range (`1e999`) are rewritten as `OVERFLOW` strings, or `None` when it has none. A string, its escapes included, is copied as it is.
- **The bands are every layer on screen, back to front, and the card last.** `crates/deep-show/src/hub/bands.rs`, `BandRow` and `Hub::bands`. A `BandRow` is one layer on screen (Band), or the card. Each writer's layer goes in its band. A card the shell places counts as shown only once presented (#400).
- **One provider run answers its trap, its output, its shading counts and its own time.** `crates/deep-show/src/sandbox/make.rs`, `Host::make` and `Host::make_in`. A run gives its trap (or null), its output, kept only without a trap, its mesh's geometry.shading counts, and its own time from the rewritten bytes to the decoded output.
  - Its links are merged in by the sandbox module's linker, as a logic item's are (#190).
  - A memory past the budget's `memory` is the provider's own trap kind, `memory`.
  - geometry.shading is read on the mesh; one declared closed fails on its first open edge.
  - The output is kept by hash, its exact bytes in the evidence store: what a drawn form names.
  - A data asset in its layout, or a world's pages in pages@1, is refused by the layout's validator as any asset named at check is (#415).
  - A world's pages lie in its range, `first` to `first + count` (#211).
- **What the three history calls answer.** `crates/deep-show/src/shared/calls/history.rs`. `Hub::history` answers every revision that changed the item, in order. `Hub::by_writer` answers each layer's writer, the items it holds now and the patches its writer applied, in order. `Hub::shared_revisions` answers `revisions` of a shared document: every committed revision, the newest current. A view of the record has none: it's rebuilt from projections as of an event (Revision).

## deep-canvas

- **The transport's rates are whole numbers of flicks.** `crates/deep-canvas/src/document/check/transport.rs`. `frame_rate_of` reads the transport's `frame_rate` as `[p, q]`, as `p/q` text, or as a whole number `p` (p/1), when it is one. `check_transport` holds the valid-rates rule (#488; the design's Time and the flick): a frame rate whose frame, or a sample rate whose sample, isn't a whole number of flicks is refused with `bad_rate` naming the rate. A rate that isn't a rate at all is refused the same way.
- **The expression parser's nesting is capped.** `crates/deep-canvas/src/document/packs/parser.rs`, `Parser`. `depth` is how deep the expression being read nests. `nest` runs `f` one level deeper, refused past the closed function list's nesting cap. An atom is read with its indexes and members, `a[i].b`. A word led by a digit, such as a stage's `3d` or a time's `0.5s`, is a bare word (#142). A call's arguments are read after its `(`, through its `)`.

## deep-gpu-layer and deep-scene3d-render

- **#462's planted `status_in_look`.** `crates/deep-gpu-layer/src/view3d/in_look.rs`, `in_look_status`. It gives the status map of the look a render draws in, where it has one of its own; `None` for the shipped program, which draws the document's.
- **Our DFG table (#421).** `crates/deep-scene3d-render/src/albedo.rs`, `dfg_table`. For 32 cosines of the view angle across and 32 roughnesses down, it holds the GGX lobe's directional albedo split as F0·A + F90·B, by Hammersley importance sampling in f64, two entries to a vec4. Its samples include both ends, so roughness 1 and a view along the normal are read exactly (#422's white furnace). A sample's weight under GGX importance sampling is V × 4 n·l v·h ÷ n·h.
- **The sheen table (#428).** `crates/deep-scene3d-render/src/albedo.rs`, `sheen_table`. It holds the sheen lobe's directional albedo: ∫ D V (n·l) dω of Charlie's distribution and Estevez and Kulla's visibility (KHR_materials_sheen) at α = max(roughness, 10⁻³)², on the grid of 64 cos views by 32 sheen roughnesses, packed four to an entry after the DFG table. Its entries are written the first time a scene shades sheen.
