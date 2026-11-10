//! `acceptance-544-wat <out-dir> <file.wat>...`: assembles each WebAssembly text file to
//! `<out-dir>/<stem>.wasm`, after `wasmparser` validates it. Exit 1 with the error on stderr when a
//! file doesn't assemble or validate.

use std::path::{Path, PathBuf};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some((dir, files)) = args.split_first() else {
        eprintln!("usage: acceptance-544-wat <out-dir> <file.wat>...");
        std::process::exit(2);
    };
    let dir = PathBuf::from(dir);
    let mut failed = false;
    for file in files {
        let path = Path::new(file);
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("out");
        let built = wat::parse_file(path)
            .map_err(|e| e.to_string())
            .and_then(|bytes| wasmparser::validate(&bytes).map(|_| bytes).map_err(|e| e.to_string()));
        match built {
            Ok(bytes) => std::fs::write(dir.join(format!("{stem}.wasm")), &bytes).expect("write the .wasm"),
            Err(e) => {
                eprintln!("{file}: {e}");
                failed = true;
            }
        }
    }
    if failed {
        std::process::exit(1);
    }
}
