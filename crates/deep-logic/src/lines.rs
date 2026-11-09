//! Source lines through a program's debug sidecar (#531): `debug: asset ID` names a module of the
//! build's `.debug_*` sections, kept by hash outside the program, so the program's hash, its bake
//! and its goldens are the same with the sidecar or without it. DWARF's addresses in WebAssembly
//! are offsets into the code section of the program as given; a trap's offset, which the runner
//! reads through the rewrite's offset map, is one.

use std::rc::Rc;

use gimli::{EndianRcSlice, LittleEndian, Reader as _};
use wasmparser::{Parser, Payload};

type R = EndianRcSlice<LittleEndian>;

/// The sidecar's DWARF, for the program it was split from.
pub struct Lines {
    sections: Vec<(String, Rc<[u8]>)>,
    context: addr2line::Context<R>,
    dwarf: gimli::Dwarf<R>,
    /// Where the program's code section's contents start.
    code: u32,
}

impl std::fmt::Debug for Lines {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Lines {{ code: {} }}", self.code)
    }
}

impl Clone for Lines {
    fn clone(&self) -> Lines {
        Lines::from_sections(self.sections.clone(), self.code).expect("the same DWARF loads again")
    }
}

/// Where a module's code section's contents start.
pub fn code_start(bytes: &[u8]) -> Option<u32> {
    Parser::new(0).parse_all(bytes).find_map(|p| match p {
        Ok(Payload::CodeSectionStart { range, .. }) => Some(range.start as u32),
        _ => None,
    })
}

impl Lines {
    pub fn new(program: &[u8], sidecar: &[u8]) -> Result<Lines, String> {
        let mut sections: Vec<(String, Rc<[u8]>)> = Vec::new();
        for p in Parser::new(0).parse_all(sidecar) {
            match p.map_err(|e| format!("the debug sidecar isn't a WebAssembly module: {e}"))? {
                Payload::CustomSection(c) if c.name().starts_with(".debug_") => {
                    sections.push((c.name().to_string(), Rc::from(c.data())))
                }
                Payload::CustomSection(_) | Payload::Version { .. } | Payload::End(_) => {}
                _ => {
                    return Err("the debug sidecar holds only the build's .debug_* sections".into())
                }
            }
        }
        let code = code_start(program).ok_or("the program has no code section")?;
        Lines::from_sections(sections, code)
    }

    fn from_sections(sections: Vec<(String, Rc<[u8]>)>, code: u32) -> Result<Lines, String> {
        let load = || {
            gimli::Dwarf::load(|id| -> Result<R, gimli::Error> {
                let data = sections
                    .iter()
                    .find(|(n, _)| n == id.name())
                    .map_or_else(|| Rc::from(&[][..]), |(_, d)| d.clone());
                Ok(EndianRcSlice::new(data, LittleEndian))
            })
            .map_err(|e| format!("the debug sidecar's DWARF doesn't load: {e}"))
        };
        let context = addr2line::Context::from_dwarf(load()?)
            .map_err(|e| format!("the debug sidecar's DWARF doesn't read: {e}"))?;
        let dwarf = load()?;
        Ok(Lines {
            sections,
            context,
            dwarf,
            code,
        })
    }

    /// `file:line` of the instruction at a module offset of the program as given.
    pub fn at(&self, offset: u32) -> Option<String> {
        self.at_address(u64::from(offset.checked_sub(self.code)?))
    }

    /// `file:line` of a code address, as DWARF counts it.
    pub fn at_address(&self, address: u64) -> Option<String> {
        let l = self.context.find_location(address).ok()??;
        match (l.file, l.line) {
            (Some(f), Some(n)) if n > 0 => Some(format!("{f}:{n}")),
            _ => None,
        }
    }

    /// `file:line` of the function holding a module offset: its declaration's file and line.
    pub fn function_at(&self, offset: u32) -> Option<String> {
        let address = u64::from(offset.checked_sub(self.code)?);
        let mut units = self.dwarf.units();
        while let Ok(Some(header)) = units.next() {
            let Ok(unit) = self.dwarf.unit(header) else {
                continue;
            };
            let mut entries = unit.entries();
            while let Ok(Some(e)) = entries.next_dfs() {
                if e.tag() != gimli::DW_TAG_subprogram {
                    continue;
                }
                let Ok(mut ranges) = self.dwarf.die_ranges(&unit, e) else {
                    continue;
                };
                let mut inside = false;
                while let Ok(Some(r)) = ranges.next() {
                    inside |= r.begin <= address && address < r.end;
                }
                if !inside {
                    continue;
                }
                let line = e.attr_value(gimli::DW_AT_decl_line)?.udata_value()?;
                let index = match e.attr_value(gimli::DW_AT_decl_file)? {
                    gimli::AttributeValue::FileIndex(i) => i,
                    v => v.udata_value()?,
                };
                let program = unit.line_program.as_ref()?;
                let file = program.header().file(index)?;
                let name = self.dwarf.attr_string(&unit, file.path_name()).ok()?;
                let mut path = String::new();
                if let Some(dir) = file.directory(program.header()) {
                    if let Ok(d) = self.dwarf.attr_string(&unit, dir) {
                        path = format!("{}/", d.to_string_lossy().ok()?);
                    }
                }
                return Some(format!("{path}{}:{line}", name.to_string_lossy().ok()?));
            }
        }
        None
    }
}
