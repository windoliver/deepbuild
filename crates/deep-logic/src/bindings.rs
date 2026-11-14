//! Typed bindings for a logic item's regions (#548): Rust source a program includes, from the
//! item's region map in declaration order, so the program reads and writes each read, write and
//! emit entry by name and type at the offset check computes, and exports the item's layout digest
//! as `regions_digest`. Reading an entry as another type is a type error at the reader's line.

use crate::piece::{Emit, Layout, Region, Ty};

/// An element type's Rust type.
fn rust_ty(ty: &str) -> Option<&'static str> {
    Some(match ty {
        "bool" => "u32",
        "i32" => "i32",
        "f64" => "f64",
        "vec2" => "[f64; 2]",
        "vec3" => "[f64; 3]",
        "quat" => "[f64; 4]",
        "i64" => "i64",
        _ => return None,
    })
}

/// A name as a Rust identifier: anything past ASCII letters, digits and `_` becomes `_`.
fn ident(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

/// The type an entry's accessor hands back, and its doc line.
fn entry(e: &Region, emits: &[Emit]) -> (String, String) {
    let doc = format!(
        "{}.{}: {} ({} B at {})",
        e.region, e.name, e.ty, e.size, e.offset
    );
    let ty = if e.region == "emits" {
        format!("Emits<{}, {}>", row_name(&e.name), max_of(&e.name, emits))
    } else if let Some(t) = rust_ty(&e.ty) {
        let n = Ty::named(&e.ty).map_or(1, |t| e.size / t.size());
        if n == 1 {
            t.to_string()
        } else {
            format!("[{t}; {n}]")
        }
    } else {
        match e.ty.as_str() {
            "control" => "Slot<f64>".into(),
            "pick" => "Slot<Pick>".into(),
            "action" => "Slot<[u8; 16]>".into(),
            // A point's records are packed end to end, and a text's commit is its bytes.
            _ => format!("[u8; {}]", e.size),
        }
    };
    (ty, doc)
}

fn row_name(kind: &str) -> String {
    let mut s = String::new();
    for part in ident(kind).split('_').filter(|p| !p.is_empty()) {
        let mut c = part.chars();
        s.extend(c.next().map(|f| f.to_ascii_uppercase()));
        s.push_str(c.as_str());
    }
    s + "Row"
}

fn max_of(kind: &str, emits: &[Emit]) -> u32 {
    emits.iter().find(|e| e.kind == kind).map_or(0, |e| e.max)
}

/// The Rust bindings of item `item`, whose region map is `layout`. `by_name`: the planted
/// generator that orders each region's fields by name rather than in declaration order.
pub fn rust(item: &str, layout: &Layout, emits: &[Emit], by_name: bool) -> String {
    let mut out = format!(
        "//! Bindings for logic item `{item}`, layout digest {:016x}, from its region map in\n\
         //! declaration order (deep_kinds bindings, #548). Include it as a module: it exports the\n\
         //! regions and `regions_digest`, and each entry is read and written by name and type.\n\
         #![allow(non_upper_case_globals, dead_code, static_mut_refs)]\n\n\
         #[no_mangle]\npub static regions_digest: i64 = 0x{:016x}_u64 as i64;\n\n\
         #[repr(C)]\npub struct Entry<V> {{ pub player: u32, _pad: u32, pub value: V }}\n\
         #[repr(C)]\npub struct Slot<V> {{ pub count: u32, _pad: u32, pub entries: [Entry<V>; 16] }}\n\
         #[repr(C)]\npub struct Pick {{ pub set: u32, _pad: u32, pub key: [i64; 2] }}\n\
         #[repr(C, packed)]\npub struct Emits<R, const N: usize> {{ pub count: u32, pub rows: [R; N] }}\n\
         #[repr(C, align(8))]\npub struct Region<const N: usize>(pub [u8; N]);\n",
        layout.digest, layout.digest
    );
    for e in emits {
        out.push_str(&format!(
            "\n#[repr(C, packed)]\n#[derive(Clone, Copy)]\npub struct {} {{ pub a: u32, pub b: u32",
            row_name(&e.kind)
        ));
        for (name, ty) in &e.fields {
            out.push_str(&format!(
                ", pub {}: {}",
                ident(name),
                rust_ty(ty.name()).unwrap_or("u32")
            ));
        }
        out.push_str(" }\n");
    }
    for region in ["reads", "writes", "emits"] {
        let mut list: Vec<&Region> = layout
            .entries
            .iter()
            .filter(|e| e.region == region)
            .collect();
        if list.is_empty() && region == "emits" {
            continue;
        }
        let size = list
            .iter()
            .map(|e| e.offset + e.size)
            .max()
            .unwrap_or(0)
            .max(8);
        out.push_str(&format!(
            "\n#[no_mangle]\npub static mut {region}_at: Region<{size}> = Region([0; {size}]);\n\n\
             /// The {region} region's entries, in declaration order.\npub mod {region} {{\n    use super::*;\n"
        ));
        if by_name {
            list.sort_by(|a, b| a.name.cmp(&b.name));
        }
        // The planted generator lays fields end to end in its own order, as a naive one would.
        let mut packed = 0;
        for e in list {
            let (ty, doc) = entry(e, emits);
            let offset = if by_name { packed } else { e.offset };
            packed = (packed + e.size).div_ceil(8) * 8;
            out.push_str(&format!(
                "    /// {doc}\n    pub const {}_OFFSET: usize = {offset};\n    \
                 #[inline]\n    pub fn {}() -> &'static mut {ty} {{\n        \
                 unsafe {{ &mut *((core::ptr::addr_of_mut!({region}_at) as *mut u8).add({offset}) as *mut {ty}) }}\n    }}\n",
                ident(&e.name).to_ascii_uppercase(),
                ident(&e.name),
            ));
        }
        out.push_str("}\n");
    }
    out
}
