//! #1042: the faces a web player's bundle carries, each subset to the glyphs the piece's text can
//! show (canvas primitives: Export: web player). The characters are every one a string of the
//! document or of its played form holds, in its NFC and NFD forms and in either case, every one a
//! text asset it names holds, and the ones the core's own formats write beside them (ASCII, the
//! spaces, signs and marks of a number, an ellipsis). A piece whose viewer types the text an entry
//! shows, or that names an asset this can read neither as text nor as a medium that holds none,
//! can show any glyph, so its faces travel whole. The subsetter is the one of the font crates the
//! shaper reads faces with: it renumbers the glyphs it keeps and closes them over every script and
//! layout feature, so a subset sets the piece's text as the whole face does, and it keeps every
//! name record, so the face's name and its license travel with it.

use std::collections::BTreeSet;

use read_fonts::collections::IntSet;
use read_fonts::types::{GlyphId, NameId, Tag};
use read_fonts::FontRef;
use serde_json::Value;
use skera::{subset_font, Plan, SubsetFlags};
use unicode_normalization::UnicodeNormalization;

/// What the core's own formats write that no string of a document need hold: the no-break and
/// thin spaces, the degree, micro, middle dot and times signs, the hyphens and dashes, the
/// quotes a locale groups digits with, the ellipsis, the per mille sign, the minus sign, the
/// dotted circle a lone mark sits on and the replacement character.
const WRITTEN: &str = "\u{a0}\u{b0}\u{b5}\u{b7}\u{d7}\u{2009}\u{2010}\u{2011}\u{2013}\u{2014}\u{2018}\u{2019}\u{201c}\u{201d}\u{2026}\u{202f}\u{2030}\u{2212}\u{25cc}\u{fffd}";

/// The characters a piece's text can show, gathered from its strings and its text assets; `None`
/// once the piece can show any.
pub(super) struct Shown(Option<BTreeSet<u32>>);

impl Shown {
    /// The characters every piece can show: ASCII and [`WRITTEN`].
    pub(super) fn new() -> Shown {
        let mut shown = Shown(Some((0x20..0x7f).collect()));
        shown.text(WRITTEN);
        shown
    }

    /// `text`'s characters, as written, composed and decomposed, and in either case.
    fn text(&mut self, text: &str) {
        let Some(chars) = self.0.as_mut() else {
            return;
        };
        for c in text.chars().chain(text.nfc()).chain(text.nfd()) {
            chars.insert(c as u32);
            chars.extend(c.to_uppercase().map(u32::from));
            chars.extend(c.to_lowercase().map(u32::from));
        }
    }

    /// Every string `doc` holds, its keys too; a text control's entries are the viewer's own
    /// words (Text `text@1`: entries), which no string here holds.
    pub(super) fn document(&mut self, doc: &Value) {
        let typed = doc["controls"]
            .as_object()
            .into_iter()
            .flatten()
            .any(|(_, c)| c["kind"] == "text");
        if typed {
            self.0 = None;
        }
        self.strings(doc);
    }

    fn strings(&mut self, v: &Value) {
        match v {
            Value::String(s) => self.text(s),
            Value::Array(a) => a.iter().for_each(|x| self.strings(x)),
            Value::Object(m) => m.iter().for_each(|(k, x)| {
                self.text(k);
                self.strings(x);
            }),
            _ => {}
        }
    }

    /// An asset the document names: its characters when it reads as text, nothing when it is a
    /// picture, a map, sound, a program or a model, and any character otherwise.
    pub(super) fn asset(&mut self, bytes: &[u8]) {
        let at = |o: usize, magic: &[u8]| bytes.get(o..o + magic.len()) == Some(magic);
        match std::str::from_utf8(bytes) {
            Ok(text) => self.text(text),
            Err(_) if super::web::compresses_itself(bytes) => {}
            Err(_) if at(0, b"\0asm") || at(0, b"glTF") || (at(0, b"RIFF") && at(8, b"WAVE")) => {}
            Err(_) => self.0 = None,
        }
    }

    /// `face`'s bytes as the bundle carries them: subset to what the piece can show, or whole.
    pub(super) fn face(&self, face: &[u8]) -> Result<Vec<u8>, String> {
        let Some(chars) = &self.0 else {
            return Ok(face.to_vec());
        };
        let font = FontRef::new(face).map_err(|e| e.to_string())?;
        let chars: IntSet<u32> = chars.iter().copied().collect();
        // A signature covers the whole face's bytes, so it never travels with a part of them.
        let signature: IntSet<Tag> = [Tag::new(b"DSIG")].into_iter().collect();
        let mut scripts = IntSet::<Tag>::empty();
        scripts.invert();
        let plan = Plan::new(
            &IntSet::<GlyphId>::empty(),
            &chars,
            &font,
            SubsetFlags::SUBSET_FLAGS_NOTDEF_OUTLINE
                | SubsetFlags::SUBSET_FLAGS_NAME_LEGACY
                | SubsetFlags::SUBSET_FLAGS_PASSTHROUGH_UNRECOGNIZED,
            &signature,
            &scripts,
            &IntSet::<Tag>::all(),
            &IntSet::<NameId>::all(),
            &IntSet::<u16>::all(),
        );
        subset_font(&font, &plan).map_err(|e| e.to_string())
    }
}
