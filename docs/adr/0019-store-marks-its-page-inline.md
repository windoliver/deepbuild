# 0019: A store marks its page with no call

Status: accepted (#3530). The design states the rule under Logic: sandbox, `rewrite.pages` (`docs/canvas-primitives.md`); the decisions below are the ones written nowhere else.

## The mark

- **Where the bitmap is one word, a store sets its pages' bits itself.** `crates/deep-canvas-sandbox/src/rewrite.rs`, `Body::rewrite`; `Counters`, `only_bitmap_word`. A memory of at most 64 pages has a bitmap of one word. The rewrite's tracker is a function, and no engine inlines a call by default, so a step that mostly writes cost 2.49 times the record's ns per fuel unit (#3445).
- **A store marks the pages of its first and its last byte, and no other.** `Body::rewrite`. A store writes at most 8 bytes, so it reaches at most two pages. The mark runs after the store, so both bytes lie inside memory and the address plus the instruction's offset doesn't wrap. A one-byte store marks one page. These are the bits the tracker set.
- **`memory.fill`, `memory.copy` and a larger memory keep the tracker.** `Body::rewrite`; `tracker`. Their ranges cross any number of pages and words. Every logic item's program still carries the tracker, so its function indices are the same whichever mark a store has.
- **The marks charge no fuel and no stack.** `Body::rewrite`. They are the rewrite's own code, as the tracker is, so a step is charged what it was charged before.

## The planted rewrite

- **The page marked last is kept in a global no runner knows.** `rewrite_as`, `planted_last_marked_page`; `Faults`, `store_skips_page_marked_last`. It follows the bitmap's word and the block counts, starts at −1, which is no page, and has no export, so nothing clears it with the bitmap. A store whose first byte lies in that page marks nothing: that is the fault `tests/acceptance/3530` plants.
