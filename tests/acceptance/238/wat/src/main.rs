//! `acceptance-238-wat <out-dir> <file.wat>...`: assembles each WebAssembly text file to
//! `<out-dir>/<stem>.wasm` and lists its function bodies to `<out-dir>/<stem>.ops.json`:
//! `{"functions": [{"index", "start", "end", "ops": [[offset, name], ...]}]}`, where `index` is the
//! function's index in the module's function index space (imports first), `start`..`end` the body's
//! byte range in the module, and each op its byte offset in the module with wasmparser's operator name
//! (`I32DivS`, `MemoryFill`, ...). Exit 1 with the error on stderr when a file doesn't assemble; a body
//! the listing can't read is written as `{"error"}` instead (the bytes are still written).

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

fn listing(bytes: &[u8]) -> Result<String, String> {
    let mut parser = wasmparser::Parser::new(0);
    parser.set_features(wasmparser::WasmFeatures::all());
    let mut imported = 0u32;
    let mut next = 0u32;
    let mut out = String::from("{\"functions\": [");
    let mut first = true;
    for payload in parser.parse_all(bytes) {
        match payload.map_err(|e| e.to_string())? {
            wasmparser::Payload::ImportSection(reader) => {
                for import in reader.into_imports() {
                    if let wasmparser::TypeRef::Func(_) = import.map_err(|e| e.to_string())?.ty {
                        imported += 1;
                    }
                }
                next = imported;
            }
            wasmparser::Payload::CodeSectionEntry(body) => {
                let range = body.range();
                let mut ops = String::new();
                let mut reader = body.get_operators_reader().map_err(|e| e.to_string())?;
                while !reader.eof() {
                    let (op, offset) = reader.read_with_offset().map_err(|e| e.to_string())?;
                    let debug = format!("{op:?}");
                    let name = debug.split([' ', '{', '(']).next().unwrap_or("");
                    if !ops.is_empty() {
                        ops.push_str(", ");
                    }
                    let _ = write!(ops, "[{offset}, \"{name}\"]");
                }
                if !first {
                    out.push_str(", ");
                }
                first = false;
                let _ = write!(out, "{{\"index\": {next}, \"start\": {}, \"end\": {}, \"ops\": [{ops}]}}", range.start, range.end);
                next += 1;
            }
            _ => {}
        }
    }
    out.push_str("]}");
    Ok(out)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some((dir, files)) = args.split_first() else {
        eprintln!("usage: acceptance-238-wat <out-dir> <file.wat>...");
        std::process::exit(2);
    };
    let dir = PathBuf::from(dir);
    let mut failed = false;
    for file in files {
        let path = Path::new(file);
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("out");
        match wat::parse_file(path) {
            Ok(bytes) => {
                let list = listing(&bytes).unwrap_or_else(|e| format!("{{\"error\": {:?}}}", e));
                std::fs::write(dir.join(format!("{stem}.wasm")), &bytes).expect("write the .wasm");
                std::fs::write(dir.join(format!("{stem}.ops.json")), list).expect("write the listing");
            }
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
