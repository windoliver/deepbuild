//! The blank guard (issue #377): it runs before every image comparison a parity fixture makes. A
//! frame that is blank or black on either side, luma at most 0.06 over at least 98% of its pixels,
//! makes the comparison BLOCKED with no other number, never PASS. The one exception is a frame
//! your decision declared dark for that fixture, recorded once with its hash, whose object-ID pass
//! still shows each item the fixture keeps. An agent can't declare a frame dark, and a fixture
//! where both sides draw nothing is BLOCKED whatever was declared.

use std::collections::BTreeMap;

/// A pixel counts as dark at or below this luma (sRGB-encoded, 0 to 1).
pub const DARK_LUMA: f64 = 0.06;
/// A frame is blank when at least this share of its pixels is dark.
pub const BLANK_SHARE: f64 = 0.98;

/// Who declared a frame dark.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum By {
    You,
    Agent,
}

/// The share of a frame's pixels that are dark, for premultiplied BGRA bytes: each pixel's Rec.
/// 709 luma as it shows over black.
fn dark_share(bgra: &[u8]) -> f64 {
    let pixels = bgra.len() / 4;
    if pixels == 0 {
        return 1.0;
    }
    let dark = bgra
        .as_chunks::<4>()
        .0
        .iter()
        .filter(|p| {
            let luma =
                (0.0722 * f64::from(p[0]) + 0.7152 * f64::from(p[1]) + 0.2126 * f64::from(p[2]))
                    / 255.0;
            luma <= DARK_LUMA
        })
        .count();
    dark as f64 / pixels as f64
}

pub fn is_blank(bgra: &[u8]) -> bool {
    dark_share(bgra) >= BLANK_SHARE
}

/// Dark declarations, one per fixture and frame hash, each recorded once.
#[derive(Default)]
pub struct Declarations {
    dark: BTreeMap<(String, String), By>,
}

impl Declarations {
    /// Records that `by` declared the frame with `hash` dark for `fixture`. An agent's declaration
    /// is refused; a second declaration of the same frame is refused as already recorded.
    pub fn declare(&mut self, fixture: &str, hash: &str, by: By) -> Result<(), &'static str> {
        if by == By::Agent {
            return Err("agent_cannot_declare_dark");
        }
        let key = (fixture.to_string(), hash.to_string());
        if self.dark.contains_key(&key) {
            return Err("already_recorded");
        }
        self.dark.insert(key, by);
        Ok(())
    }

    pub fn is_declared(&self, fixture: &str, hash: &str) -> bool {
        self.dark
            .contains_key(&(fixture.to_string(), hash.to_string()))
    }
}

/// One side of a comparison: its bytes, its hash, and, for the dark exception, which item IDs its
/// object-ID pass shows.
pub struct Side<'a> {
    pub bgra: &'a [u8],
    pub hash: &'a str,
    pub object_ids: Option<&'a [u32]>,
}

/// Why the guard blocked a comparison.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Blocked {
    /// A side is blank and not declared dark.
    Blank { side: &'static str },
    /// Both sides draw nothing.
    BothBlank,
    /// Declared dark, but the object-ID pass doesn't show this kept item.
    MissingItem { side: &'static str, item: u32 },
}

impl Blocked {
    pub fn reason(&self) -> String {
        match self {
            Blocked::Blank { side } => format!("the {side} frame is blank or black"),
            Blocked::BothBlank => "both sides draw nothing".into(),
            Blocked::MissingItem { side, item } => {
                format!("the {side} frame is declared dark but its object-ID pass doesn't show item {item}")
            }
        }
    }
}

/// The guard: Ok when the comparison may run.
pub fn check(
    fixture: &str,
    sides: [(&'static str, Side<'_>); 2],
    kept: &[u32],
    declared: &Declarations,
) -> Result<(), Blocked> {
    let blank = [is_blank(sides[0].1.bgra), is_blank(sides[1].1.bgra)];
    let draws_nothing = |side: &Side<'_>| side.object_ids.is_none_or(|ids| ids.is_empty());
    if blank[0] && blank[1] && draws_nothing(&sides[0].1) && draws_nothing(&sides[1].1) {
        return Err(Blocked::BothBlank);
    }
    for (i, (name, side)) in sides.iter().enumerate() {
        if !blank[i] {
            continue;
        }
        if !declared.is_declared(fixture, side.hash) {
            return Err(Blocked::Blank { side: name });
        }
        let shown = side.object_ids.unwrap_or(&[]);
        if let Some(&item) = kept.iter().find(|k| !shown.contains(k)) {
            return Err(Blocked::MissingItem { side: name, item });
        }
    }
    Ok(())
}
