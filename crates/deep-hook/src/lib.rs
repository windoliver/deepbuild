//! deep-hook's library: the guard matcher and the shell reader the binary decides with (#316). It is a library so
//! the local preflight's cargo-semver-checks can diff its public items against the merge base (#139), and a change
//! to them shows in the pull request that made it.

pub mod matcher;
pub mod shell;
