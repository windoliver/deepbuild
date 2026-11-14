//! The export canvas module (issue #162; canvas primitives: Export: Lottie): the Lottie writer
//! and the `export` check kind. deep-show writes the file, reads it back through the reference
//! renderer and keeps the receipt; this crate decides what the file holds and what it lists.

pub mod lottie;
pub mod module;
