//! One layout for a struct the renderer writes and a shader reads (issue #3256).
//!
//! A host struct names its shader struct once, beside its definition, with [`paired!`](crate::paired):
//! the shader file and the struct's name. From that line the crate's unit lane gets a test,
//! `<label>::shader_layout`, that parses the module as the renderer assembles it, with naga, and
//! compares the two field by field: the same number of fields in the same order, each with the
//! same name, the same byte offset and the same scalars, and the two sizes equal. The host's
//! offsets and size are the compiler's (`offset_of!`, `size_of`); the shader's are naga's own
//! layout of the struct. An instance or vertex record names its attribute list and the entry
//! point the list feeds as well, and is held three ways: its fields against the list's offsets
//! and formats, and each location against the shader input there, by name and type.
//!
//! A crate's [`Lane`], in its `shader_layout` module, names its modules and the structs that
//! have one side only, each with its reason, and [`Lane::closed`] fails a `#[repr(C)]` struct
//! or a bound shader struct that is neither paired nor listed. Each test prints what it held as
//! `layout` lines (tests/acceptance/3256/README.md). Nothing here opens a GPU device.

use std::path::Path;
use std::sync::OnceLock;

use wgpu::naga;

/// What a scalar holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Float,
    Uint,
    Sint,
    Bool,
}

/// One scalar in a buffer: its first byte, what it holds and its width in bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Scalar {
    at: u32,
    kind: Kind,
    width: u32,
}

/// A type the host writes into a buffer: its scalars from `at`, as the compiler lays them out.
pub trait Scalars {
    fn scalars(at: u32, out: &mut Vec<Scalar>);
}

macro_rules! scalar {
    ($($ty:ty: $kind:ident),*) => {$(
        impl Scalars for $ty {
            fn scalars(at: u32, out: &mut Vec<Scalar>) {
                out.push(Scalar { at, kind: Kind::$kind, width: size_of::<$ty>() as u32 });
            }
        }
    )*};
}
scalar!(f32: Float, u32: Uint, i32: Sint);

impl<T: Scalars, const N: usize> Scalars for [T; N] {
    fn scalars(at: u32, out: &mut Vec<Scalar>) {
        for k in 0..N {
            T::scalars(at + (k * size_of::<T>()) as u32, out);
        }
    }
}

/// A host struct's field: its name and type as written, its offset from `offset_of!`, and its
/// scalars from its own first byte.
pub struct Field {
    name: &'static str,
    ty: &'static str,
    at: u32,
    scalars: Vec<Scalar>,
}

impl Field {
    pub fn of<T: Scalars>(name: &'static str, ty: &'static str, at: usize) -> Field {
        let mut scalars = Vec::new();
        T::scalars(0, &mut scalars);
        Field {
            name,
            ty,
            at: at as u32,
            scalars,
        }
    }

    /// Its bytes: to the end of its last scalar.
    fn size(&self) -> u32 {
        self.scalars.last().map_or(0, |s| s.at + s.width)
    }
}

/// A host struct as the compiler lays it out: its size is `size_of`'s.
pub struct Host {
    pub name: &'static str,
    pub file: &'static str,
    pub size: usize,
    pub fields: Vec<Field>,
}

/// A shader module as the renderer assembles it: the files it is made of, and its text.
pub struct Module {
    files: &'static [&'static str],
    source: String,
    parsed: OnceLock<Result<naga::Module, String>>,
}

impl Module {
    pub fn new(files: &'static [&'static str], source: impl Into<String>) -> Module {
        Module {
            files,
            source: source.into(),
            parsed: OnceLock::new(),
        }
    }

    /// The module as naga reads it, parsed once.
    fn parsed(&self) -> &naga::Module {
        let parsed = self.parsed.get_or_init(|| {
            naga::front::wgsl::parse_str(&self.source).map_err(|e| e.emit_to_string(&self.source))
        });
        match parsed {
            Ok(module) => module,
            Err(e) => panic!("naga can't read the module of {:?}: {e}", self.files),
        }
    }
}

/// A shader type's scalars from `at`, by naga's layout: a struct's members at their offsets,
/// an array's elements a stride apart.
fn scalars(module: &naga::Module, ty: naga::Handle<naga::Type>, at: u32, out: &mut Vec<Scalar>) {
    let scalar = |s: &naga::Scalar, at: u32| Scalar {
        at,
        kind: match s.kind {
            naga::ScalarKind::Float => Kind::Float,
            naga::ScalarKind::Uint => Kind::Uint,
            naga::ScalarKind::Sint => Kind::Sint,
            _ => Kind::Bool,
        },
        width: u32::from(s.width),
    };
    match &module.types[ty].inner {
        naga::TypeInner::Scalar(s) | naga::TypeInner::Atomic(s) => out.push(scalar(s, at)),
        naga::TypeInner::Vector { size, scalar: s } => {
            out.extend((0..*size as u32).map(|k| scalar(s, at + k * u32::from(s.width))));
        }
        naga::TypeInner::Matrix {
            columns,
            rows,
            scalar: s,
        } => {
            // A column is a vector of `rows` scalars, aligned as one: to two scalars for a
            // vec2, to four for a vec3 or a vec4.
            let width = u32::from(s.width);
            let stride = width * if *rows == naga::VectorSize::Bi { 2 } else { 4 };
            for c in 0..*columns as u32 {
                out.extend((0..*rows as u32).map(|r| scalar(s, at + c * stride + r * width)));
            }
        }
        naga::TypeInner::Array { base, size, stride } => {
            // A runtime-sized array is read as its first element.
            let count = match size {
                naga::ArraySize::Constant(n) => n.get(),
                _ => 1,
            };
            for k in 0..count {
                scalars(module, *base, at + k * stride, out);
            }
        }
        naga::TypeInner::Struct { members, .. } => {
            for member in members {
                scalars(module, member.ty, at + member.offset, out);
            }
        }
        _ => {}
    }
}

/// A shader type as WGSL writes it.
fn wgsl(module: &naga::Module, ty: naga::Handle<naga::Type>) -> String {
    let scalar = |s: &naga::Scalar| {
        let kind = match s.kind {
            naga::ScalarKind::Float => "f",
            naga::ScalarKind::Uint => "u",
            naga::ScalarKind::Sint => "i",
            _ => return "bool".to_string(),
        };
        format!("{kind}{}", u32::from(s.width) * 8)
    };
    let ty = &module.types[ty];
    match &ty.inner {
        naga::TypeInner::Scalar(s) => scalar(s),
        naga::TypeInner::Atomic(s) => format!("atomic<{}>", scalar(s)),
        naga::TypeInner::Vector { size, scalar: s } => {
            format!("vec{}<{}>", *size as u32, scalar(s))
        }
        naga::TypeInner::Matrix {
            columns,
            rows,
            scalar: s,
        } => format!("mat{}x{}<{}>", *columns as u32, *rows as u32, scalar(s)),
        naga::TypeInner::Array { base, size, .. } => match size {
            naga::ArraySize::Constant(n) => format!("array<{}, {n}>", wgsl(module, *base)),
            _ => format!("array<{}>", wgsl(module, *base)),
        },
        _ => ty.name.clone().unwrap_or_else(|| "?".to_string()),
    }
}

/// The shader struct `name` of a module: its members and its size, naga's.
fn shader_struct<'a>(
    module: &'a naga::Module,
    name: &str,
) -> Option<(&'a [naga::StructMember], u32)> {
    module.types.iter().find_map(|(_, ty)| match &ty.inner {
        naga::TypeInner::Struct { members, span } if ty.name.as_deref() == Some(name) => {
            Some((members.as_slice(), *span))
        }
        _ => None,
    })
}

/// What a pair's line says of a host field beyond its name: the shader's name for it, the
/// shader's names for its elements, or that it is padding.
enum Rename<'a> {
    Same,
    Padding,
    To(&'a str),
    Elements(Vec<&'a str>),
}

fn rename<'a>(renames: &[(&str, &'a str)], field: &str) -> Rename<'a> {
    match renames.iter().find(|(from, _)| *from == field) {
        None => Rename::Same,
        Some((_, "_")) => Rename::Padding,
        Some((_, to)) => match to.strip_prefix('[').and_then(|t| t.strip_suffix(']')) {
            Some(list) => Rename::Elements(list.split(',').map(str::trim).collect()),
            None => Rename::To(to),
        },
    }
}

/// How a host struct and a shader struct differ, one line each, none when they agree. With
/// `sums_host_sizes`, #3256's planted comparison, the shader's offsets and size are not naga's
/// but the host's field sizes summed.
fn differences(
    host: &Host,
    module: &naga::Module,
    name: &str,
    renames: &[(&str, &str)],
    sums_host_sizes: bool,
) -> Vec<String> {
    let mut found = Vec::new();
    for (from, _) in renames {
        if !host.fields.iter().any(|f| f.name == *from) {
            found.push(format!(
                "the pair renames `{from}`, which {} doesn't have",
                host.name
            ));
        }
    }
    let Some((members, span)) = shader_struct(module, name) else {
        found.push(format!("the module has no struct `{name}`"));
        return found;
    };
    let summed = |to: Option<&Field>| -> u32 {
        let before = host
            .fields
            .iter()
            .take_while(|f| !to.is_some_and(|to| std::ptr::eq(*f, to)));
        before.map(Field::size).sum()
    };
    let span = if sums_host_sizes { summed(None) } else { span };
    let fields: Vec<(&Field, &str)> = host
        .fields
        .iter()
        .filter_map(|f| match rename(renames, f.name) {
            Rename::Padding => None,
            Rename::To(to) => Some((f, to)),
            _ => Some((f, f.name)),
        })
        .collect();
    if fields.len() != members.len() {
        found.push(format!(
            "{} has {} fields and `{name}` has {}",
            host.name,
            fields.len(),
            members.len()
        ));
    }
    for (k, ((field, expected), member)) in fields.iter().zip(members).enumerate() {
        let theirs = member.name.as_deref().unwrap_or("?");
        let offset = if sums_host_sizes {
            summed(Some(field))
        } else {
            member.offset
        };
        if theirs != *expected {
            found.push(format!(
                "field {k}: `{}` at offset {} in {}, `{theirs}` at offset {offset} in `{name}`",
                field.name, field.at, host.name
            ));
            // With a field more on one side, every later place holds another field too.
            if fields.len() != members.len() {
                break;
            }
            continue;
        } else if field.at != offset {
            found.push(format!(
                "field {k} `{}`: at offset {} in {}, at offset {offset} in `{name}`",
                field.name, field.at, host.name
            ));
        }
        let mut shader = Vec::new();
        scalars(module, member.ty, 0, &mut shader);
        if shader != field.scalars {
            found.push(format!(
                "field {k} `{}`: `{}` in {}, `{}` in `{name}`",
                field.name,
                field.ty,
                host.name,
                wgsl(module, member.ty)
            ));
        }
    }
    if host.size != span as usize {
        found.push(format!(
            "sizes: {} is {} bytes and `{name}` is {span}",
            host.name, host.size
        ));
    }
    found
}

/// A vertex format's scalars: what each holds, its width, and how many.
fn format_scalars(format: wgpu::VertexFormat) -> Option<(Kind, u32, u32)> {
    use wgpu::VertexFormat as F;
    Some(match format {
        F::Float32 => (Kind::Float, 4, 1),
        F::Float32x2 => (Kind::Float, 4, 2),
        F::Float32x3 => (Kind::Float, 4, 3),
        F::Float32x4 => (Kind::Float, 4, 4),
        F::Uint32 => (Kind::Uint, 4, 1),
        F::Uint32x2 => (Kind::Uint, 4, 2),
        F::Uint32x3 => (Kind::Uint, 4, 3),
        F::Uint32x4 => (Kind::Uint, 4, 4),
        F::Sint32 => (Kind::Sint, 4, 1),
        F::Sint32x2 => (Kind::Sint, 4, 2),
        F::Sint32x3 => (Kind::Sint, 4, 3),
        F::Sint32x4 => (Kind::Sint, 4, 4),
        _ => return None,
    })
}

/// An entry point's inputs by location: each one's name and type, an argument's own or a
/// member's of an argument that is a struct.
fn inputs(
    module: &naga::Module,
    entry: &naga::EntryPoint,
) -> Vec<(u32, String, naga::Handle<naga::Type>)> {
    let mut found = Vec::new();
    let mut at = |binding: &Option<naga::Binding>, name: &Option<String>, ty| {
        if let Some(naga::Binding::Location { location, .. }) = binding {
            found.push((*location, name.clone().unwrap_or_default(), ty));
        }
    };
    for argument in &entry.function.arguments {
        at(&argument.binding, &argument.name, argument.ty);
        if let naga::TypeInner::Struct { members, .. } = &module.types[argument.ty].inner {
            for member in members {
                at(&member.binding, &member.name, member.ty);
            }
        }
    }
    found
}

/// How a record, its attribute list and an entry point's inputs differ, one line each.
fn record_differences(
    host: &Host,
    attributes: &[wgpu::VertexAttribute],
    module: &naga::Module,
    entry: &str,
    renames: &[(&str, &str)],
) -> Vec<String> {
    let mut found = Vec::new();
    let Some(point) = module.entry_points.iter().find(|e| e.name == entry) else {
        return vec![format!("the module has no entry point `{entry}`")];
    };
    let inputs = inputs(module, point);
    for attribute in attributes {
        let (location, offset) = (attribute.shader_location, attribute.offset as u32);
        let Some((kind, width, count)) = format_scalars(attribute.format) else {
            found.push(format!(
                "location {location}: the lane doesn't read the format {:?}",
                attribute.format
            ));
            continue;
        };
        let wanted: Vec<Scalar> = (0..count)
            .map(|k| Scalar {
                at: k * width,
                kind,
                width,
            })
            .collect();
        // The record's field under the attribute, and which of its elements when it is an
        // array of them.
        let Some(field) = host
            .fields
            .iter()
            .find(|f| f.at <= offset && offset < f.at + f.size())
        else {
            found.push(format!(
                "location {location}: offset {offset} is past {}'s {} bytes",
                host.name, host.size
            ));
            continue;
        };
        let within = offset - field.at;
        let under: Vec<Scalar> = field
            .scalars
            .iter()
            .filter(|s| within <= s.at && s.at < within + count * width)
            .map(|s| Scalar {
                at: s.at - within,
                ..*s
            })
            .collect();
        if under != wanted {
            found.push(format!(
                "location {location}: {:?} at offset {offset} in the list, `{}: {}` at offset {} in {}",
                attribute.format, field.name, field.ty, field.at, host.name
            ));
        }
        let Some((_, input, ty)) = inputs.iter().find(|(at, ..)| *at == location) else {
            found.push(format!("location {location}: `{entry}` has no input there"));
            continue;
        };
        let mut shader = Vec::new();
        scalars(module, *ty, 0, &mut shader);
        if shader != wanted {
            found.push(format!(
                "location {location}: {:?} in the list, `{input}: {}` in `{entry}`",
                attribute.format,
                wgsl(module, *ty)
            ));
        }
        let expected = match rename(renames, field.name) {
            Rename::To(to) => Some(to),
            Rename::Elements(names) => names.get((within / (count * width)) as usize).copied(),
            Rename::Padding => None,
            Rename::Same => (within == 0).then_some(field.name),
        };
        if expected != Some(input.as_str()) {
            found.push(format!(
                "location {location}: `{}` at offset {offset} in {}, `{input}` in `{entry}`",
                field.name, host.name
            ));
        }
    }
    found
}

/// One clause of a host struct's line.
pub enum Clause<'a> {
    /// The shader struct `name` of `file`.
    Struct {
        file: &'a str,
        name: &'a str,
        renames: &'a [(&'a str, &'a str)],
    },
    /// The attribute list `list` and the entry point of `file` it feeds.
    Record {
        list: &'a str,
        attributes: &'a [wgpu::VertexAttribute],
        file: &'a str,
        entry: &'a str,
        renames: &'a [(&'a str, &'a str)],
    },
}

/// A crate's layout lane: its shader modules as its renderer assembles them, and the structs
/// that have one side only, each with its reason.
pub struct Lane {
    /// The lane's own file (`file!()`), which gives the crate's `src` from the checkout's root.
    pub file: &'static str,
    /// The crate's folder (`CARGO_MANIFEST_DIR`), whose `src` holds its host structs.
    pub root: &'static str,
    pub modules: Vec<Module>,
    /// `#[repr(C)]` structs no shader struct mirrors: the file under `src`, the struct, and why.
    pub host_only: &'static [(&'static str, &'static str, &'static str)],
    /// Shader structs bound as `var<uniform>` or `var<storage>` that no host struct names: the
    /// file that declares it, the struct, and why.
    pub gpu_only: &'static [(&'static str, &'static str, &'static str)],
    /// #3256's planted comparison, which sums the host's field sizes for the shader's offsets
    /// and size: a wrong program a test must catch.
    pub sums_host_sizes: bool,
}

impl Lane {
    /// The modules assembled from `file`.
    fn modules_of(&self, file: &str) -> Vec<&Module> {
        let modules: Vec<&Module> = self
            .modules
            .iter()
            .filter(|m| m.files.contains(&file))
            .collect();
        assert!(
            !modules.is_empty(),
            "no module in this crate's layout lane is assembled from {file}"
        );
        modules
    }

    /// How `host` and the shader struct `name` differ in the modules assembled from `file`,
    /// each difference once.
    fn differences(
        &self,
        host: &Host,
        file: &str,
        name: &str,
        renames: &[(&str, &str)],
    ) -> Vec<String> {
        let mut found = Vec::new();
        for module in self.modules_of(file) {
            for differ in differences(host, module.parsed(), name, renames, self.sums_host_sizes) {
                if !found.contains(&differ) {
                    found.push(differ);
                }
            }
        }
        found
    }

    /// Holds a host struct to each clause of its line, in every module assembled from the
    /// clause's file: a shader struct field by field, and an attribute list three ways, the
    /// record's fields against the list's offsets and formats and each location against the
    /// entry point's input there, by name and type. A record's field under no attribute of
    /// any of its lists must be listed as padding. Prints a line for each clause when all of
    /// them hold; panics with every difference.
    pub fn hold(&self, host: &Host, clauses: &[Clause]) {
        let (mut held, mut found) = (Vec::new(), Vec::new());
        // A record's fields that an attribute reads, or its line calls padding.
        let mut read: Option<Vec<&str>> = None;
        for clause in clauses {
            match clause {
                Clause::Struct {
                    file,
                    name,
                    renames,
                } => {
                    let mut differ = self.differences(host, file, name, renames);
                    let text = std::fs::read_to_string(Path::new(self.root).join("src").join(file));
                    if !text.is_ok_and(|text| declares(&text, name)) {
                        differ.push(format!("{file} doesn't declare the struct `{name}`"));
                    }
                    if !differ.is_empty() {
                        found.push(format!(
                            "{} ({}) and `{name}` ({file}) differ:\n  {}",
                            host.name,
                            host.file,
                            differ.join("\n  ")
                        ));
                    }
                    let compared = host
                        .fields
                        .iter()
                        .filter(|f| !matches!(rename(renames, f.name), Rename::Padding));
                    let fields: Vec<String> =
                        compared.map(|f| format!("{}@{}", f.name, f.at)).collect();
                    held.push(format!(
                        "layout pair {}:{} = {file}#{name}: {}; {} bytes",
                        host.file,
                        host.name,
                        fields.join(" "),
                        host.size
                    ));
                }
                Clause::Record {
                    list,
                    attributes,
                    file,
                    entry,
                    renames,
                } => {
                    let mut differ: Vec<String> = Vec::new();
                    for module in self.modules_of(file) {
                        differ.extend(record_differences(
                            host,
                            attributes,
                            module.parsed(),
                            entry,
                            renames,
                        ));
                    }
                    differ.dedup();
                    if !differ.is_empty() {
                        found.push(format!(
                            "{} ({}), its attribute list {list} and `{entry}` ({file}) differ:\n  {}",
                            host.name,
                            host.file,
                            differ.join("\n  ")
                        ));
                    }
                    let read = read.get_or_insert_with(Vec::new);
                    for field in &host.fields {
                        let under = |a: &wgpu::VertexAttribute| {
                            field.at <= a.offset as u32
                                && (a.offset as u32) < field.at + field.size()
                        };
                        if attributes.iter().any(under)
                            || matches!(rename(renames, field.name), Rename::Padding)
                        {
                            read.push(field.name);
                        }
                    }
                    let locations: Vec<String> = attributes
                        .iter()
                        .map(|a| a.shader_location.to_string())
                        .collect();
                    held.push(format!(
                        "layout record {}:{} = {list}: {file}#{entry} at locations {}",
                        host.file,
                        host.name,
                        locations.join(", ")
                    ));
                }
            }
        }
        for field in &host.fields {
            if read
                .as_ref()
                .is_some_and(|read| !read.contains(&field.name))
            {
                found.push(format!(
                    "{} ({}): `{}` at offset {} is under no attribute of its lists and is not listed as padding",
                    host.name, host.file, field.name, field.at
                ));
            }
        }
        assert!(found.is_empty(), "{}", found.join("\n"));
        for line in held {
            println!("{line}");
        }
    }

    /// Runs the comparison on a pair that is there to differ, and prints how it differs;
    /// panics when the comparison finds the two to agree.
    pub fn differs(&self, host: &Host, file: &str, name: &str) {
        let found = self.differences(host, file, name, &[]);
        assert!(
            !found.is_empty(),
            "{} ({}) and `{name}` ({file}) are there to differ, and the comparison finds them to agree",
            host.name,
            host.file
        );
        println!(
            "layout differs {}:{} = {file}#{name}: {}",
            host.file,
            host.name,
            found.join("; ")
        );
    }

    /// Coverage, closed both ways: every `#[repr(C)]` struct under the crate's `src` is paired
    /// or listed as host-only; every shader struct a module binds as `var<uniform>` or
    /// `var<storage>` is named by a pair or listed as gpu-only; a source file whose text binds
    /// a struct is in a module or on that list; and no entry of either list is stale. Prints
    /// both lists; panics naming each struct that is neither.
    pub fn closed(&self) {
        let sources = sources(&Path::new(self.root).join("src"));
        let text = |file: &str| {
            sources
                .iter()
                .find(|(f, _)| f == file)
                .map_or("", |(_, t)| t.as_str())
        };
        let src = self.file.rsplit_once('/').map_or("", |(src, _)| src);
        let structs = host_structs(&sources);
        let (mut listing, mut open) = (Vec::new(), Vec::new());
        for s in &structs {
            let reason = self
                .host_only
                .iter()
                .find(|(file, name, _)| *file == s.file && *name == s.name);
            match (s.paired, reason) {
                (true, None) => {}
                (false, Some((.., why))) => listing.push(format!("layout host-only {src}/{}:{}: {why}", s.file, s.name)),
                (true, Some(_)) => open.push(format!(
                    "{} ({}) names a shader struct and is listed as host-only",
                    s.name, s.file
                )),
                (false, None) => open.push(format!(
                    "the #[repr(C)] struct {} ({}) names no shader struct and is not listed as host-only",
                    s.name, s.file
                )),
            }
        }
        for (file, name, _) in self.host_only {
            if !structs.iter().any(|s| s.file == *file && s.name == *name) {
                open.push(format!(
                    "{name} ({file}) is listed as host-only and is no #[repr(C)] struct there"
                ));
            }
        }
        // Each bound struct with the file that declares it: by naga in the lane's modules, by
        // the text in a file no module is assembled from.
        let mut bound: Vec<(&str, String)> = Vec::new();
        for module in &self.modules {
            for name in bound_structs(module.parsed()) {
                let file = module
                    .files
                    .iter()
                    .find(|file| declares(text(file), &name))
                    .unwrap_or(&module.files[0]);
                if !bound.iter().any(|(f, n)| f == file && *n == name) {
                    bound.push((file, name));
                }
            }
        }
        for (file, text) in &sources {
            let assembled = self
                .modules
                .iter()
                .any(|m| m.files.contains(&file.as_str()));
            for name in bound_in_text(text) {
                if !assembled && !bound.iter().any(|(f, n)| f == file && *n == name) {
                    bound.push((file, name));
                }
            }
        }
        let pairs: Vec<&(String, String)> = structs.iter().flat_map(|s| &s.pairs).collect();
        for (file, name) in &bound {
            let paired = pairs.iter().any(|(f, n)| f == file && n == name);
            let listed = self.gpu_only.iter().any(|(f, n, _)| f == file && n == name);
            match (paired, listed) {
                (true, false) | (false, true) => {}
                (true, true) => open.push(format!(
                    "`{name}` ({file}) is named by a host struct and listed as gpu-only"
                )),
                (false, false) => open.push(format!(
                    "the shader struct `{name}` ({file}) is bound as var<uniform> or var<storage>: no host struct names it, and it is not listed as gpu-only"
                )),
            }
        }
        for (file, name, why) in self.gpu_only {
            if bound.iter().any(|(f, n)| f == file && n == name) {
                listing.push(format!("layout gpu-only {file}#{name}: {why}"));
            } else {
                open.push(format!(
                    "`{name}` ({file}) is listed as gpu-only, and nothing there binds it"
                ));
            }
        }
        for line in listing {
            println!("{line}");
        }
        let paired = structs.iter().filter(|s| s.paired).count();
        println!(
            "layout lane {src}: {} #[repr(C)] structs, {paired} paired and {} host-only; {} bound shader structs, {} gpu-only",
            structs.len(),
            structs.len() - paired,
            bound.len(),
            self.gpu_only.len()
        );
        assert!(
            open.is_empty(),
            "the layout lane isn't closed:\n  {}",
            open.join("\n  ")
        );
    }
}

/// The struct types a module binds as `var<uniform>` or `var<storage>`, an array's as its
/// element's.
fn bound_structs(module: &naga::Module) -> Vec<String> {
    let mut found = Vec::new();
    for (_, variable) in module.global_variables.iter() {
        if !matches!(
            variable.space,
            naga::AddressSpace::Uniform | naga::AddressSpace::Storage { .. }
        ) {
            continue;
        }
        let mut ty = variable.ty;
        while let naga::TypeInner::Array { base, .. } = module.types[ty].inner {
            ty = base;
        }
        if let (naga::TypeInner::Struct { .. }, Some(name)) =
            (&module.types[ty].inner, &module.types[ty].name)
        {
            if !found.contains(name) {
                found.push(name.clone());
            }
        }
    }
    found
}

/// The struct types a source file's own text binds as `var<uniform>` or `var<storage>`: the
/// type after the variable's colon, past every `array<`, when it starts with a capital as a
/// struct's name does here. This is how a shader in a file no module is assembled from is
/// seen at all.
fn bound_in_text(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    for line in text
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
    {
        for space in ["var<uniform>", "var<storage"] {
            let Some((_, ty)) = line
                .split_once(space)
                .and_then(|(_, rest)| rest.split_once(':'))
            else {
                continue;
            };
            let mut ty = ty.trim_start();
            while let Some(element) = ty.strip_prefix("array<") {
                ty = element;
            }
            let name: String = ty
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            if name.starts_with(char::is_uppercase) && !found.contains(&name) {
                found.push(name);
            }
        }
    }
    found
}

/// Whether a file's text declares the struct `name`.
fn declares(text: &str, name: &str) -> bool {
    text.match_indices("struct ").any(|(at, word)| {
        let after = text[at + word.len()..].strip_prefix(name);
        after.is_some_and(|after| !after.starts_with(|c: char| c.is_alphanumeric() || c == '_'))
    })
}

/// Every `.rs` and `.wgsl` file under `src`, by its path from there, with its text, in path
/// order.
fn sources(src: &Path) -> Vec<(String, String)> {
    let mut found = Vec::new();
    let mut folders = vec![src.to_path_buf()];
    while let Some(folder) = folders.pop() {
        let entries =
            std::fs::read_dir(&folder).unwrap_or_else(|e| panic!("{}: {e}", folder.display()));
        for path in entries.map(|entry| entry.expect("a folder entry").path()) {
            if path.is_dir() {
                folders.push(path);
            } else if path.extension().is_some_and(|e| e == "rs" || e == "wgsl") {
                let text = std::fs::read_to_string(&path)
                    .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
                let file = path
                    .strip_prefix(src)
                    .expect("under src")
                    .to_string_lossy()
                    .replace('\\', "/");
                found.push((file, text));
            }
        }
    }
    found.sort();
    found
}

/// A `#[repr(C)]` struct as a crate's source has it: its file under `src`, its name, whether a
/// `paired!` holds it, and the shader structs its line names, each a file and a name.
struct Found {
    file: String,
    name: String,
    paired: bool,
    pairs: Vec<(String, String)>,
}

/// Every `#[repr(C)]` struct of the `.rs` sources, in file and line order.
fn host_structs(sources: &[(String, String)]) -> Vec<Found> {
    let mut found = Vec::new();
    for (file, text) in sources.iter().filter(|(file, _)| file.ends_with(".rs")) {
        // The clauses of a `paired!` whose struct hasn't begun yet.
        let mut clauses: Option<String> = None;
        let mut lines = text
            .lines()
            .map(str::trim)
            .filter(|line| !line.starts_with("//"));
        while let Some(line) = lines.next() {
            if let Some((_, rest)) = line.split_once("paired! {") {
                clauses = Some(rest.to_string());
            } else if !line.starts_with("#[repr(C") {
                // A clause may run over lines, up to the struct's first attribute.
                if let Some(text) = clauses.as_mut().filter(|_| !line.starts_with('#')) {
                    text.push_str(line);
                }
            } else if let Some(item) = lines.find(|line| !line.starts_with('#')) {
                // The item under the attribute, past its other attributes: a struct counts.
                let item = item.strip_prefix("pub").map_or(item, |rest| {
                    rest.trim_start_matches(|c: char| c != ' ').trim_start()
                });
                let held = clauses.take();
                if let Some(rest) = item.strip_prefix("struct ") {
                    found.push(Found {
                        file: file.clone(),
                        name: rest
                            .chars()
                            .take_while(|c| c.is_alphanumeric() || *c == '_')
                            .collect(),
                        paired: held.is_some(),
                        pairs: held.as_deref().map_or_else(Vec::new, named),
                    });
                }
            }
        }
    }
    found
}

/// The shader structs a `paired!`'s clauses name: each `"file", Name` that isn't an attribute
/// list's entry point.
fn named(clauses: &str) -> Vec<(String, String)> {
    let mut found = Vec::new();
    for clause in clauses.split(';') {
        let mut quoted = clause.split('"');
        let (Some(before), Some(file), Some(after)) = (quoted.next(), quoted.next(), quoted.next())
        else {
            continue;
        };
        if before.contains("=>") {
            continue;
        }
        let name: String = after
            .trim_start_matches([',', ' '])
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        found.push((file.to_string(), name));
    }
    found
}

/// Names a host struct's shader struct beside its definition: a label, then the shader file
/// and the struct's name, then the struct. A clause may list, in braces, each field whose name
/// differs (`host: shader`) and each field that is padding (`host: _`), and a struct more than
/// one module declares takes a clause for each. A record adds a clause for each attribute list
/// and the entry point it feeds, `LIST => "file.wgsl", entry`, where a field over several
/// attributes lists their inputs' names (`rows: [r0, r1, r2]`). `label: differs "file", Name;`
/// is a pair that is there to differ, which the test fails when the comparison passes it.
///
/// The struct is defined as written. Under `cfg(test)` it also gets the test
/// `<label>::shader_layout`, which holds each clause through the crate's
/// `shader_layout::lane()`: the calling crate's, so `crate` here is meant.
#[allow(clippy::crate_in_macro_def)]
#[macro_export]
macro_rules! paired {
    ($label:ident: differs $file:literal, $name:ident; # $($item:tt)+) => {
        $crate::paired!(@host $label host [
            crate::shader_layout::lane().differs(&host, $file, stringify!($name))
        ] # $($item)+);
    };
    (
        $label:ident:
        $($($list:ident =>)? $file:literal, $name:ident $({ $($from:ident: $to:tt),* $(,)? })?;)+
        # $($item:tt)+
    ) => {
        $crate::paired!(@host $label host [
            crate::shader_layout::lane().hold(&host, &[$($crate::paired!(
                @clause $($list =>)? $file, $name, [$($((stringify!($from), stringify!($to))),*)?]
            )),+])
        ] # $($item)+);
    };
    (
        @host $label:ident $laid:ident [$held:expr]
        $(#[doc = $doc:expr])*
        #[repr(C)]
        $(#[$meta:meta])*
        $vis:vis struct $host:ident {
            $($(#[$fmeta:meta])* $fvis:vis $field:ident: $ty:ty),* $(,)?
        }
    ) => {
        $(#[doc = $doc])*
        #[repr(C)]
        $(#[$meta])*
        $vis struct $host {
            $($(#[$fmeta])* $fvis $field: $ty),*
        }

        #[cfg(test)]
        impl $crate::layout::Scalars for $host {
            fn scalars(at: u32, out: &mut Vec<$crate::layout::Scalar>) {
                $(<$ty as $crate::layout::Scalars>::scalars(
                    at + ::core::mem::offset_of!($host, $field) as u32,
                    out,
                );)*
            }
        }

        #[cfg(test)]
        mod $label {
            use super::*;

            #[test]
            fn shader_layout() {
                let $laid = $crate::layout::Host {
                    name: stringify!($host),
                    file: file!(),
                    size: ::core::mem::size_of::<$host>(),
                    fields: vec![$($crate::layout::Field::of::<$ty>(
                        stringify!($field),
                        stringify!($ty),
                        ::core::mem::offset_of!($host, $field),
                    )),*],
                };
                $held;
            }
        }
    };
    (@clause $file:literal, $name:ident, $renames:expr) => {
        $crate::layout::Clause::Struct {
            file: $file,
            name: stringify!($name),
            renames: &$renames,
        }
    };
    (@clause $list:ident => $file:literal, $name:ident, $renames:expr) => {
        $crate::layout::Clause::Record {
            list: stringify!($list),
            attributes: &$list,
            file: $file,
            entry: stringify!($name),
            renames: &$renames,
        }
    };
}
