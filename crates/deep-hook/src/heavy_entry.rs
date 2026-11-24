//! `deep-hook heavy`, which prints the entry a command line matches (moved out of main.rs whole, #3292).

use std::io::Read;
use std::path::PathBuf;
use std::process::ExitCode;
use std::{env, io};

use crate::{heavy, quoted};

/// `deep-hook heavy`: the heavy.command@1 entry a command line on stdin matches in the current folder (#1016), as
/// `{"name", "jobs", "jobs_flag"}`, or `null`; `deep lease` reads it to know how the command takes jobs.
pub(crate) fn heavy_entry() -> ExitCode {
    let mut command = String::new();
    let _ = io::stdin().read_to_string(&mut command);
    let cwd = env::current_dir().ok();
    let home = PathBuf::from(env::var_os("HOME").unwrap_or_default());
    match heavy::matched(&command, cwd.as_deref(), &home, None) {
        Some(hit) => println!(
            "{{\"name\":{},\"jobs\":{},\"jobs_flag\":{},\"memory_mb\":{}}}",
            quoted(&hit.name),
            quoted(&hit.jobs),
            hit.jobs_flag.as_deref().map_or("null".to_string(), quoted),
            hit.memory_mb.map_or("null".to_string(), |m| m.to_string())
        ),
        None => println!("null"),
    }
    ExitCode::SUCCESS
}
