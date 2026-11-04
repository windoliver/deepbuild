//! The merge base's whole-list reads, kept here so the reference survives #1141 changing deep-app: `states.rs` and
//! `notify.rs` are crates/deep-app/src/states.rs and notify.rs at 15de8c5b, copied verbatim without their test
//! modules (each file's header says the one line changed). AC2 compares the app's folded reads against these.
#![allow(dead_code)]

pub mod notify;
pub mod states;
