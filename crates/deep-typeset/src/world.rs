//! The Typst world the typeset job compiles in: one generated main file, mitex's scope files
//! (Apache-2.0, kept with their notice in `mitex/LICENSE`), and the fonts its caller handed in.
//! It reads no clock, no package and no file system, so the same source gives the same frame.

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};

/// mitex's Typst files, by their path in the world.
const MITEX: [(&str, &str); 3] = [
    (
        "/mitex/specs/mod.typ",
        include_str!("../mitex/specs/mod.typ"),
    ),
    (
        "/mitex/specs/prelude.typ",
        include_str!("../mitex/specs/prelude.typ"),
    ),
    (
        "/mitex/specs/latex/standard.typ",
        include_str!("../mitex/specs/latex/standard.typ"),
    ),
];

/// What stays across jobs in one process: the library, the fonts and mitex's parsed files.
pub struct Base {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    mitex: Vec<Source>,
}

impl Default for Base {
    fn default() -> Self {
        Self::new()
    }
}

impl Base {
    pub fn new() -> Self {
        let mitex = MITEX
            .iter()
            .map(|(path, text)| Source::new(id_of(path), (*text).to_owned()))
            .collect();
        Self {
            library: LazyHash::new(Library::default()),
            book: LazyHash::new(FontBook::new()),
            fonts: Vec::new(),
            mitex,
        }
    }

    /// Adds each face of a font file; false when the bytes hold none.
    pub fn add_font(&mut self, bytes: Vec<u8>) -> bool {
        let data = Bytes::new(bytes);
        let before = self.fonts.len();
        for font in Font::iter(data) {
            let mut book = (*self.book).clone();
            book.push(font.info().clone());
            self.book = LazyHash::new(book);
            self.fonts.push(font);
        }
        self.fonts.len() > before
    }

    pub fn fonts(&self) -> &[Font] {
        &self.fonts
    }
}

/// One job's world: the base and the job's main file.
pub struct Job<'a> {
    base: &'a Base,
    main: Source,
}

impl<'a> Job<'a> {
    pub fn new(base: &'a Base, text: String) -> Self {
        Self {
            base,
            main: Source::new(id_of("/main.typ"), text),
        }
    }
}

fn id_of(path: &str) -> FileId {
    RootedPath::new(
        VirtualRoot::Project,
        VirtualPath::new(path).expect("a fixed path"),
    )
    .intern()
}

impl World for Job<'_> {
    fn library(&self) -> &LazyHash<Library> {
        &self.base.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.base.book
    }

    fn main(&self) -> FileId {
        self.main.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            return Ok(self.main.clone());
        }
        self.base
            .mitex
            .iter()
            .find(|s| s.id() == id)
            .cloned()
            .ok_or(FileError::AccessDenied)
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        self.source(id)
            .map(|s| Bytes::from_string(s.text().to_owned()))
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.base.fonts.get(index).cloned()
    }

    fn today(&self, _offset: Option<typst::foundations::Duration>) -> Option<Datetime> {
        None
    }
}
