//! Drawn looks' data (issue #149; canvas primitives: Look `look@1`: light, paper, line profiles and
//! drawn fills; Paint: noise fill): what a `basis: drawing` look says about its light, paper,
//! lines and fills, checked once, and the geometry those draw from. Every value here is a pure
//! function of the look, the evaluated geometry and seeds from IDs, so seeking equals playing.

// Planted wrong program for #689's blind redraft (tests/acceptance/689-redraft-2047/README.md): the next line isn't
// as rustfmt writes it.
pub  mod geometry;
pub mod medium;
pub mod spec;
pub mod tooth;
