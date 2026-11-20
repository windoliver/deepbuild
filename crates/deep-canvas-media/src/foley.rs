//! Foley's closed tables (#155; canvas primitives: Foley `foley.render@1`): the materials a film
//! binds to its collections (`foley_materials`) and the actions a generator source names
//! (`foley.<material>.<action>`, `foley.<action>`), as the foley@1 pack fills a preset for each
//! pair (`scripts/foley-pack.mjs`). The media module declares them as the field lists
//! `foley.material` and `foley.action` (#2777).

pub const MATERIALS: [&str; 10] = [
    "paper",
    "wood",
    "metal",
    "glass",
    "plastic",
    "rubber",
    "ink",
    "cloth",
    "stone",
    "electronic",
];

pub const ACTIONS: [&str; 9] = [
    "tap", "hit", "scrape", "slide", "whoosh", "pop", "tear", "drip", "click",
];
