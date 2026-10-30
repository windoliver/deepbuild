//! A terminal emulator for the cell grid (canvas primitives: Cell grid `cells@1`): bytes in, a
//! grid of typed cells out, with the terminal's title, cwd, progress and bells from its escapes.
//! It keeps scrollback, the alternate screen and the modes a program asks for (bracketed paste,
//! application cursor keys, focus events, the mouse). The clipboard escape (OSC 52) is read but
//! never answered: a write is shown, a read is refused and counted, so no byte of the clipboard
//! ever reaches the program. The emulator has no way to write to the program at all; what it
//! would answer, only a planted twin sends.
//!
//! Pure and deterministic: no I/O, no clock.

use std::collections::BTreeMap;

/// The attribute names a frame lists, in bit order (Cell grid: `attrs: [name]`).
pub const ATTRS: [&str; 6] = ["bold", "italic", "underline", "inverse", "dim", "strike"];
const BOLD: u16 = 1;
const ITALIC: u16 = 2;
const UNDERLINE: u16 = 4;
const INVERSE: u16 = 8;
const DIM: u16 = 16;
const STRIKE: u16 = 32;

/// A cell's color: the palette's default, one of its 16 ANSI roles (or the 256-color cube), or a
/// truecolor value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Color {
    Default,
    Indexed(u8),
    Rgb([u8; 3]),
}

/// A cell's grapheme: none (a blank cell), one code point, or a cluster of several.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum G {
    Empty,
    One(char),
    Many(Box<str>),
}

impl G {
    pub fn is_empty(&self) -> bool {
        *self == G::Empty
    }

    /// The grapheme's text, `""` for a blank cell.
    pub fn text(&self) -> String {
        let mut s = String::new();
        self.push_to(&mut s);
        s
    }

    fn push_to(&self, s: &mut String) {
        match self {
            G::Empty => {}
            G::One(c) => s.push(*c),
            G::Many(t) => s.push_str(t),
        }
    }

    fn ends_with_zwj(&self) -> bool {
        match self {
            G::Empty => false,
            G::One(c) => *c == '\u{200d}',
            G::Many(t) => t.ends_with('\u{200d}'),
        }
    }

    fn extend(&mut self, c: char) {
        let mut t = self.text();
        t.push(c);
        *self = G::Many(t.into_boxed_str());
    }
}

/// One cell: its grapheme, colors, attribute bits and link ID (0 for none).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cell {
    pub g: G,
    pub fg: Color,
    pub bg: Color,
    pub attrs: u16,
    pub link: u32,
}

impl Cell {
    fn blank(pen: &Pen) -> Cell {
        Cell {
            g: G::Empty,
            fg: Color::Default,
            bg: pen.bg,
            attrs: 0,
            link: 0,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Pen {
    fg: Color,
    bg: Color,
    attrs: u16,
    link: u32,
}

impl Default for Pen {
    fn default() -> Pen {
        Pen {
            fg: Color::Default,
            bg: Color::Default,
            attrs: 0,
            link: 0,
        }
    }
}

/// The cursor's shape (DECSCUSR).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Block,
    Bar,
    Underline,
}

impl Shape {
    pub fn name(self) -> &'static str {
        match self {
            Shape::Block => "block",
            Shape::Bar => "bar",
            Shape::Underline => "underline",
        }
    }
}

/// The modes a program asked for (Cell grid: `modes`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Modes {
    pub alt_screen: bool,
    pub bracketed_paste: bool,
    pub app_cursor: bool,
    pub focus_events: bool,
    /// Mouse tracking asked for (1000, 1002 or 1003).
    pub mouse: bool,
    /// SGR mouse encoding (1006).
    pub sgr: bool,
}

impl Modes {
    /// `none | x10 | sgr`.
    pub fn mouse_name(&self) -> &'static str {
        match (self.mouse, self.sgr) {
            (false, _) => "none",
            (true, false) => "x10",
            (true, true) => "sgr",
        }
    }
}

/// A history row: its text alone when plain, else its cells.
#[derive(Clone, Debug)]
enum Kept {
    Plain(Box<str>),
    Styled(Vec<Cell>),
}

/// A screen: rows of cells and the cursor.
#[derive(Clone, Debug)]
struct Screen {
    rows: Vec<Vec<Cell>>,
    x: u16,
    y: u16,
    /// A write at the last column wraps before the next character (DECAWM's pending wrap).
    pending_wrap: bool,
}

impl Screen {
    fn new(cols: u16, rows: u16, pen: &Pen) -> Screen {
        Screen {
            rows: (0..rows)
                .map(|_| vec![Cell::blank(pen); usize::from(cols)])
                .collect(),
            x: 0,
            y: 0,
            pending_wrap: false,
        }
    }
}

/// The parser's state between bytes, so an escape split across writes reads as one.
#[derive(Clone, Debug, PartialEq, Eq)]
enum State {
    Ground,
    Escape,
    /// `ESC` then an intermediate such as `(`, `)` or `#`: the next byte ends it.
    EscapeIntermediate,
    Csi,
    /// An OSC string, a DCS, APC, PM or SOS string: read until its terminator.
    Osc,
    Ignore,
    /// `ESC` inside a string: `\` ends it (ST).
    StringEscape {
        osc: bool,
    },
}

/// What the emulator saw that the host, not the grid, acts on.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Clipboard {
    /// The texts a program wrote to the clipboard (OSC 52 with data): shown, never written.
    pub writes: Vec<String>,
    /// The clipboard reads a program asked for (OSC 52 with `?`): each refused and unanswered.
    pub reads_refused: u32,
}

/// The terminal: its grid, scrollback, modes and what its escapes said.
pub struct Terminal {
    cols: u16,
    rows: u16,
    main: Screen,
    alt: Option<Screen>,
    /// Rows that left the top of the main screen, oldest first, at most `history_cap`: each
    /// row's text alone when its cells are plain, its cells when any carries a color, an
    /// attribute or a link.
    history: std::collections::VecDeque<Kept>,
    history_cap: usize,
    /// Rows dropped from the front of `history` once it was full.
    history_dropped: u64,
    pen: Pen,
    saved: Option<(u16, u16, Pen)>,
    pub shape: Shape,
    pub blink: bool,
    pub visible: bool,
    pub modes: Modes,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub progress: Option<f64>,
    pub bell: u32,
    pub clipboard: Clipboard,
    /// Link ID → URL; a cell's `link` names one.
    pub links: BTreeMap<u32, String>,
    state: State,
    params: Vec<u8>,
    osc: Vec<u8>,
    /// A UTF-8 sequence being read.
    utf8: Vec<u8>,
    /// Rows a feed changed since the last [`Terminal::take_dirty`], by screen row.
    dirty: std::collections::BTreeSet<u16>,
    /// Whether the screen scrolled since the last take.
    scrolled: bool,
    /// Every OSC 52 read, with the terminator that ended it (`bel`, `st` or `c1`), for a
    /// planted host to answer; the real host never does.
    pub queries: Vec<(Vec<u8>, &'static str)>,
}

impl Terminal {
    pub fn new(cols: u16, rows: u16, history_cap: usize) -> Terminal {
        let pen = Pen::default();
        Terminal {
            cols: cols.max(1),
            rows: rows.max(1),
            main: Screen::new(cols.max(1), rows.max(1), &pen),
            alt: None,
            history: std::collections::VecDeque::new(),
            history_cap,
            history_dropped: 0,
            pen,
            saved: None,
            shape: Shape::Block,
            blink: true,
            visible: true,
            modes: Modes::default(),
            title: None,
            cwd: None,
            progress: None,
            bell: 0,
            clipboard: Clipboard::default(),
            links: BTreeMap::new(),
            state: State::Ground,
            params: Vec::new(),
            osc: Vec::new(),
            utf8: Vec::new(),
            dirty: std::collections::BTreeSet::new(),
            scrolled: false,
            queries: Vec::new(),
        }
    }

    pub fn cols(&self) -> u16 {
        self.cols
    }

    pub fn rows(&self) -> u16 {
        self.rows
    }

    /// The rows that left the top and are still kept.
    pub fn history_len(&self) -> usize {
        self.history.len()
    }

    /// The rows dropped from the front of a full history.
    pub fn history_dropped(&self) -> u64 {
        self.history_dropped
    }

    fn screen(&self) -> &Screen {
        self.alt.as_ref().unwrap_or(&self.main)
    }

    fn screen_mut(&mut self) -> &mut Screen {
        self.alt.as_mut().unwrap_or(&mut self.main)
    }

    /// The cursor's place on the screen.
    pub fn cursor(&self) -> (u16, u16) {
        let s = self.screen();
        (s.x.min(self.cols - 1), s.y)
    }

    /// The screen's row `y`.
    pub fn row(&self, y: u16) -> &[Cell] {
        &self.screen().rows[usize::from(y)]
    }

    /// History row `i`'s text, oldest first, right-trimmed.
    pub fn history_text(&self, i: usize) -> String {
        match &self.history[i] {
            Kept::Plain(t) => t.to_string(),
            Kept::Styled(cells) => Terminal::text_of(cells),
        }
    }

    /// A row's text, right-trimmed: each cell's grapheme, a blank one a space.
    pub fn text_of(row: &[Cell]) -> String {
        let mut s = String::with_capacity(row.len());
        for c in row {
            match &c.g {
                G::Empty => s.push(' '),
                g => g.push_to(&mut s),
            }
        }
        s.truncate(s.trim_end_matches(' ').len());
        s
    }

    /// The rows the feeds since the last take changed (all of them when the screen scrolled),
    /// and clears the mark.
    pub fn take_dirty(&mut self) -> usize {
        let n = if self.scrolled {
            usize::from(self.rows)
        } else {
            self.dirty.len()
        };
        self.dirty.clear();
        self.scrolled = false;
        n
    }

    /// Resizes the grid to `cols` × `rows`: rows are kept from the top, cut or padded.
    pub fn resize(&mut self, cols: u16, rows: u16) {
        let (cols, rows) = (cols.max(1), rows.max(1));
        let pen = self.pen;
        for s in std::iter::once(&mut self.main).chain(self.alt.as_mut()) {
            s.rows.resize_with(usize::from(rows), || {
                vec![Cell::blank(&pen); usize::from(cols)]
            });
            for r in &mut s.rows {
                r.resize(usize::from(cols), Cell::blank(&pen));
            }
            s.x = s.x.min(cols - 1);
            s.y = s.y.min(rows - 1);
        }
        self.cols = cols;
        self.rows = rows;
        self.scrolled = true;
    }

    /// Feeds the program's output.
    pub fn feed(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.byte(b);
        }
    }

    fn byte(&mut self, b: u8) {
        match self.state.clone() {
            State::Ground => self.ground(b),
            State::Escape => self.escape(b),
            State::EscapeIntermediate => self.state = State::Ground,
            State::Csi => match b {
                0x20..=0x3f => self.params.push(b),
                0x40..=0x7e => {
                    let params = std::mem::take(&mut self.params);
                    self.state = State::Ground;
                    self.csi(&params, b);
                }
                0x1b => self.state = State::Escape,
                0x18 | 0x1a => self.state = State::Ground,
                _ => {}
            },
            State::Osc | State::Ignore => {
                let osc = self.state == State::Osc;
                match b {
                    0x07 if osc => self.end_string("bel"),
                    0x1b => self.state = State::StringEscape { osc },
                    0x18 | 0x1a => {
                        self.osc.clear();
                        self.state = State::Ground;
                    }
                    _ if osc => self.osc_byte(b),
                    _ => {}
                }
            }
            State::StringEscape { osc } => {
                if b == b'\\' {
                    if osc {
                        self.end_string("st");
                    } else {
                        self.state = State::Ground;
                    }
                } else {
                    // An ESC that isn't ST abandons the string and starts an escape.
                    self.osc.clear();
                    self.state = State::Escape;
                    self.escape(b);
                }
            }
        }
    }

    /// A byte of an OSC string: UTF-8 C1 ST (`C2 9C`) ends it, as the 8-bit ST does.
    fn osc_byte(&mut self, b: u8) {
        if b == 0x9c && self.osc.last() == Some(&0xc2) {
            self.osc.pop();
            self.end_string("c1");
            return;
        }
        if self.osc.len() < 1 << 20 {
            self.osc.push(b);
        }
    }

    fn ground(&mut self, b: u8) {
        if !self.utf8.is_empty() || b >= 0x80 {
            self.utf8_byte(b);
            return;
        }
        match b {
            0x1b => self.state = State::Escape,
            0x07 => self.bell = self.bell.saturating_add(1),
            0x08 => {
                let s = self.screen_mut();
                s.x = s.x.saturating_sub(1);
                s.pending_wrap = false;
            }
            0x09 => {
                let cols = self.cols;
                let s = self.screen_mut();
                s.x = ((s.x / 8 + 1) * 8).min(cols - 1);
            }
            0x0a..=0x0c => self.linefeed(),
            0x0d => {
                let s = self.screen_mut();
                s.x = 0;
                s.pending_wrap = false;
            }
            0x20..=0x7e => self.put(G::One(char::from(b))),
            _ => {}
        }
    }

    /// A byte of a UTF-8 sequence; a C1 control (`C2 80` to `C2 9F`) is read as that control.
    fn utf8_byte(&mut self, b: u8) {
        if self.utf8.is_empty() {
            if !(0xc0..=0xf4).contains(&b) {
                return;
            }
            self.utf8.push(b);
            return;
        }
        if b & 0xc0 != 0x80 {
            self.utf8.clear();
            self.ground(b);
            return;
        }
        self.utf8.push(b);
        let need = match self.utf8[0] {
            0xc0..=0xdf => 2,
            0xe0..=0xef => 3,
            _ => 4,
        };
        if self.utf8.len() < need {
            return;
        }
        let seq = std::mem::take(&mut self.utf8);
        let Ok(s) = std::str::from_utf8(&seq) else {
            return;
        };
        let Some(c) = s.chars().next() else { return };
        match u32::from(c) {
            // C1 controls, as their 7-bit forms.
            0x9b => {
                self.params.clear();
                self.state = State::Csi;
            }
            0x9d => {
                self.osc.clear();
                self.state = State::Osc;
            }
            0x90 | 0x98 | 0x9e | 0x9f => self.state = State::Ignore,
            0x80..=0x9f => {}
            _ => self.put_char(c),
        }
    }

    fn escape(&mut self, b: u8) {
        self.state = State::Ground;
        match b {
            b'[' => {
                self.params.clear();
                self.state = State::Csi;
            }
            b']' => {
                self.osc.clear();
                self.state = State::Osc;
            }
            b'P' | b'X' | b'^' | b'_' => self.state = State::Ignore,
            b'(' | b')' | b'*' | b'+' | b'#' | b'%' => self.state = State::EscapeIntermediate,
            b'7' => self.save(),
            b'8' => self.restore(),
            b'D' => self.linefeed(),
            b'E' => {
                self.screen_mut().x = 0;
                self.linefeed();
            }
            b'M' => self.reverse_index(),
            b'c' => self.reset(),
            _ => {}
        }
    }

    fn reset(&mut self) {
        let history_cap = self.history_cap;
        let (cols, rows) = (self.cols, self.rows);
        let bell = self.bell;
        let clipboard = std::mem::take(&mut self.clipboard);
        let queries = std::mem::take(&mut self.queries);
        *self = Terminal::new(cols, rows, history_cap);
        self.bell = bell;
        self.clipboard = clipboard;
        self.queries = queries;
        self.scrolled = true;
    }

    fn save(&mut self) {
        let (x, y) = (self.screen().x, self.screen().y);
        self.saved = Some((x, y, self.pen));
    }

    fn restore(&mut self) {
        if let Some((x, y, pen)) = self.saved {
            self.pen = pen;
            let s = self.screen_mut();
            s.x = x;
            s.y = y;
            s.pending_wrap = false;
        }
    }

    /// A character, joined to the cell before it when it extends that cell's grapheme (a
    /// combining mark, a zero-width joiner or what follows one, a variation selector).
    fn put_char(&mut self, c: char) {
        if extends(c) {
            let s = self.screen();
            let (x, y) = if s.pending_wrap {
                (s.x, s.y)
            } else if s.x > 0 {
                (s.x - 1, s.y)
            } else {
                (u16::MAX, 0)
            };
            if x != u16::MAX {
                let cell = &mut self.screen_mut().rows[usize::from(y)][usize::from(x)];
                if !cell.g.is_empty() {
                    cell.g.extend(c);
                    self.dirty.insert(y);
                    return;
                }
            }
        }
        if self.joined_after_zwj(c).is_some() {
            return;
        }
        self.put(G::One(c));
    }

    /// After a zero-width joiner, the next character joins the same cell.
    fn joined_after_zwj(&mut self, c: char) -> Option<()> {
        let s = self.screen();
        let x = if s.pending_wrap {
            s.x
        } else {
            s.x.checked_sub(1)?
        };
        let y = s.y;
        let cell = &self.screen().rows[usize::from(y)][usize::from(x)];
        if !cell.g.ends_with_zwj() {
            return None;
        }
        self.screen_mut().rows[usize::from(y)][usize::from(x)]
            .g
            .extend(c);
        self.dirty.insert(y);
        Some(())
    }

    fn put(&mut self, g: G) {
        let cols = self.cols;
        if self.screen().pending_wrap {
            let s = self.screen_mut();
            s.x = 0;
            s.pending_wrap = false;
            self.linefeed();
        }
        let pen = self.pen;
        let s = self.screen_mut();
        let (x, y) = (s.x, s.y);
        s.rows[usize::from(y)][usize::from(x)] = Cell {
            g,
            fg: pen.fg,
            bg: pen.bg,
            attrs: pen.attrs,
            link: pen.link,
        };
        if x + 1 >= cols {
            s.pending_wrap = true;
        } else {
            s.x = x + 1;
        }
        self.dirty.insert(y);
    }

    fn linefeed(&mut self) {
        let rows = self.rows;
        let s = self.screen_mut();
        s.pending_wrap = false;
        if s.y + 1 < rows {
            s.y += 1;
        } else {
            self.scroll_up();
        }
    }

    fn scroll_up(&mut self) {
        let pen = self.pen;
        let cols = self.cols;
        let on_alt = self.alt.is_some();
        let s = self.screen_mut();
        s.rows.rotate_left(1);
        let top = std::mem::replace(
            s.rows.last_mut().expect("a row"),
            vec![Cell::blank(&pen); usize::from(cols)],
        );
        if !on_alt && self.history_cap > 0 {
            if self.history.len() >= self.history_cap {
                self.history.pop_front();
                self.history_dropped += 1;
            }
            let plain = top.iter().all(|c| {
                c.fg == Color::Default && c.bg == Color::Default && c.attrs == 0 && c.link == 0
            });
            self.history.push_back(if plain {
                Kept::Plain(Terminal::text_of(&top).into_boxed_str())
            } else {
                Kept::Styled(top)
            });
        }
        self.scrolled = true;
    }

    fn reverse_index(&mut self) {
        let pen = self.pen;
        let cols = self.cols;
        let rows = usize::from(self.rows);
        let s = self.screen_mut();
        if s.y > 0 {
            s.y -= 1;
        } else {
            s.rows.pop();
            s.rows.insert(0, vec![Cell::blank(&pen); usize::from(cols)]);
            s.rows.truncate(rows);
            self.scrolled = true;
        }
    }

    fn erase(&mut self, y: u16, from: u16, to: u16) {
        let pen = self.pen;
        let s = self.screen_mut();
        let row = &mut s.rows[usize::from(y)];
        for c in &mut row[usize::from(from)..usize::from(to)] {
            *c = Cell::blank(&pen);
        }
        self.dirty.insert(y);
    }

    fn csi(&mut self, raw: &[u8], end: u8) {
        let private = raw
            .first()
            .is_some_and(|b| matches!(b, b'?' | b'>' | b'<' | b'='));
        let lead = raw.first().copied();
        let body = if private { &raw[1..] } else { raw };
        let intermediate = body
            .iter()
            .rev()
            .find(|b| (0x20..=0x2f).contains(*b))
            .copied();
        let digits: Vec<u8> = body
            .iter()
            .copied()
            .filter(|b| !(0x20..=0x2f).contains(b))
            .collect();
        let params: Vec<u16> = std::str::from_utf8(&digits)
            .unwrap_or("")
            .split([';', ':'])
            .map(|p| p.parse::<u16>().unwrap_or(0))
            .collect();
        let p = |i: usize, d: u16| params.get(i).copied().filter(|v| *v != 0).unwrap_or(d);
        let (cols, rows) = (self.cols, self.rows);
        match (lead, intermediate, end) {
            (Some(b'?'), None, b'h' | b'l') => {
                let on = end == b'h';
                for &m in &params {
                    self.private_mode(m, on);
                }
            }
            (_, Some(b' '), b'q') => {
                let n = p(0, 1);
                self.shape = match n {
                    3 | 4 => Shape::Underline,
                    5 | 6 => Shape::Bar,
                    _ => Shape::Block,
                };
                self.blink = n == 0 || n % 2 == 1;
            }
            _ if private => {}
            (_, _, b'm') => self.sgr(&digits),
            (_, _, b'A') => {
                let s = self.screen_mut();
                s.y = s.y.saturating_sub(p(0, 1));
                s.pending_wrap = false;
            }
            (_, _, b'B' | b'e') => {
                let s = self.screen_mut();
                s.y = (s.y + p(0, 1)).min(rows - 1);
                s.pending_wrap = false;
            }
            (_, _, b'C' | b'a') => {
                let s = self.screen_mut();
                s.x = (s.x + p(0, 1)).min(cols - 1);
                s.pending_wrap = false;
            }
            (_, _, b'D') => {
                let s = self.screen_mut();
                s.x = s.x.saturating_sub(p(0, 1));
                s.pending_wrap = false;
            }
            (_, _, b'G' | b'`') => {
                let s = self.screen_mut();
                s.x = (p(0, 1) - 1).min(cols - 1);
                s.pending_wrap = false;
            }
            (_, _, b'd') => {
                let s = self.screen_mut();
                s.y = (p(0, 1) - 1).min(rows - 1);
                s.pending_wrap = false;
            }
            (_, _, b'H' | b'f') => {
                let s = self.screen_mut();
                s.y = (p(0, 1) - 1).min(rows - 1);
                s.x = (p(1, 1) - 1).min(cols - 1);
                s.pending_wrap = false;
            }
            (_, _, b'J') => {
                let (x, y) = (self.screen().x.min(cols - 1), self.screen().y);
                let (from, to) = match params.first().copied().unwrap_or(0) {
                    0 => {
                        self.erase(y, x, cols);
                        (y + 1, rows)
                    }
                    1 => {
                        self.erase(y, 0, x + 1);
                        (0, y)
                    }
                    _ => (0, rows),
                };
                for r in from..to {
                    self.erase(r, 0, cols);
                }
            }
            (_, _, b'K') => {
                let (x, y) = (self.screen().x.min(cols - 1), self.screen().y);
                match params.first().copied().unwrap_or(0) {
                    0 => self.erase(y, x, cols),
                    1 => self.erase(y, 0, x + 1),
                    _ => self.erase(y, 0, cols),
                }
            }
            (_, _, b'X') => {
                let (x, y) = (self.screen().x.min(cols - 1), self.screen().y);
                self.erase(y, x, (x + p(0, 1)).min(cols));
            }
            (_, _, b'S') => {
                for _ in 0..p(0, 1) {
                    self.scroll_up();
                }
            }
            (_, _, b's') => self.save(),
            (_, _, b'u') => self.restore(),
            _ => {}
        }
    }

    fn private_mode(&mut self, m: u16, on: bool) {
        match m {
            1 => self.modes.app_cursor = on,
            25 => self.visible = on,
            1000 | 1002 | 1003 => self.modes.mouse = on,
            1006 => self.modes.sgr = on,
            1004 => self.modes.focus_events = on,
            2004 => self.modes.bracketed_paste = on,
            47 | 1047 | 1049 => {
                if on && self.alt.is_none() {
                    if m == 1049 {
                        self.save();
                    }
                    self.alt = Some(Screen::new(self.cols, self.rows, &self.pen));
                    self.modes.alt_screen = true;
                    self.scrolled = true;
                } else if !on && self.alt.is_some() {
                    self.alt = None;
                    self.modes.alt_screen = false;
                    if m == 1049 {
                        self.restore();
                    }
                    self.scrolled = true;
                }
            }
            _ => {}
        }
    }

    fn sgr(&mut self, digits: &[u8]) {
        let text = std::str::from_utf8(digits).unwrap_or("");
        let parts: Vec<u16> = if text.is_empty() {
            vec![0]
        } else {
            text.split([';', ':'])
                .map(|p| p.parse::<u16>().unwrap_or(0))
                .collect()
        };
        let mut i = 0;
        while i < parts.len() {
            let n = parts[i];
            let pen = &mut self.pen;
            match n {
                0 => {
                    pen.fg = Color::Default;
                    pen.bg = Color::Default;
                    pen.attrs = 0;
                }
                1 => pen.attrs |= BOLD,
                2 => pen.attrs |= DIM,
                3 => pen.attrs |= ITALIC,
                4 => pen.attrs |= UNDERLINE,
                7 => pen.attrs |= INVERSE,
                9 => pen.attrs |= STRIKE,
                22 => pen.attrs &= !(BOLD | DIM),
                23 => pen.attrs &= !ITALIC,
                24 => pen.attrs &= !UNDERLINE,
                27 => pen.attrs &= !INVERSE,
                29 => pen.attrs &= !STRIKE,
                30..=37 => pen.fg = Color::Indexed((n - 30) as u8),
                39 => pen.fg = Color::Default,
                40..=47 => pen.bg = Color::Indexed((n - 40) as u8),
                49 => pen.bg = Color::Default,
                90..=97 => pen.fg = Color::Indexed((n - 90 + 8) as u8),
                100..=107 => pen.bg = Color::Indexed((n - 100 + 8) as u8),
                38 | 48 => {
                    let color = match parts.get(i + 1) {
                        Some(5) => {
                            i += 2;
                            parts.get(i).map(|v| Color::Indexed((*v).min(255) as u8))
                        }
                        Some(2) => {
                            let c = |k: usize| parts.get(i + k).map_or(0, |v| (*v).min(255) as u8);
                            let rgb = [c(2), c(3), c(4)];
                            i += 4;
                            Some(Color::Rgb(rgb))
                        }
                        _ => None,
                    };
                    if let Some(c) = color {
                        if n == 38 {
                            pen.fg = c;
                        } else {
                            pen.bg = c;
                        }
                    }
                }
                _ => {}
            }
            i += 1;
        }
    }

    /// An OSC string ended: title, cwd, a hyperlink, progress, or the clipboard.
    fn end_string(&mut self, end: &'static str) {
        self.state = State::Ground;
        let raw = std::mem::take(&mut self.osc);
        let text = String::from_utf8_lossy(&raw).into_owned();
        let (code, rest) = text.split_once(';').unwrap_or((text.as_str(), ""));
        match code {
            "0" | "2" => self.title = Some(rest.to_string()),
            "7" => self.cwd = Some(rest.to_string()),
            "8" => {
                // OSC 8 ; params ; URL; an empty URL ends the link.
                let url = rest.split_once(';').map_or("", |(_, u)| u);
                if url.is_empty() {
                    self.pen.link = 0;
                } else {
                    let id = match self.links.iter().find(|(_, u)| *u == url) {
                        Some((id, _)) => *id,
                        None => {
                            let id = self.links.len() as u32 + 1;
                            self.links.insert(id, url.to_string());
                            id
                        }
                    };
                    self.pen.link = id;
                }
            }
            "9" => {
                // ConEmu's progress: 9 ; 4 ; state ; percent.
                let mut it = rest.split(';');
                if it.next() == Some("4") {
                    let state = it.next().unwrap_or("0");
                    let pct = it.next().and_then(|p| p.parse::<f64>().ok());
                    self.progress = match state {
                        "0" => None,
                        _ => pct.map(|p| (p / 100.0).clamp(0.0, 1.0)),
                    };
                }
            }
            "52" => {
                // 52 ; selections ; data: `?` asks to read, anything else writes.
                let data = rest.split_once(';').map_or(rest, |(_, d)| d);
                if data == "?" {
                    self.clipboard.reads_refused += 1;
                    self.queries.push((raw, end));
                } else if !data.is_empty() {
                    self.clipboard.writes.push(data.to_string());
                }
            }
            _ => {}
        }
    }
}

/// Whether `c` extends the grapheme before it rather than starting a cell of its own.
fn extends(c: char) -> bool {
    matches!(u32::from(c),
        0x0300..=0x036f | 0x1ab0..=0x1aff | 0x1dc0..=0x1dff | 0x20d0..=0x20ff | 0xfe20..=0xfe2f
        | 0x200c | 0x200d | 0xfe00..=0xfe0f | 0x1f3fb..=0x1f3ff | 0xe0100..=0xe01ef)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(t: &Terminal) -> Vec<String> {
        (0..t.rows()).map(|y| Terminal::text_of(t.row(y))).collect()
    }

    #[test]
    fn lines_scroll_into_history_and_the_cursor_row_is_empty() {
        let mut t = Terminal::new(10, 3, 100);
        t.feed(b"a\r\nb\r\nc\r\nd\r\n");
        assert_eq!(text(&t), ["c", "d", ""]);
        assert_eq!(t.history_len(), 2);
        assert_eq!(t.history_text(0), "a");
    }

    #[test]
    fn an_escape_split_across_feeds_reads_as_one() {
        let mut t = Terminal::new(10, 3, 0);
        for b in b"\x1b]52;c;?\x07x" {
            t.feed(&[*b]);
        }
        assert_eq!(t.clipboard.reads_refused, 1);
        assert_eq!(text(&t)[0], "x");
    }

    #[test]
    fn every_form_of_the_clipboard_read_is_refused_and_a_write_is_shown() {
        let mut t = Terminal::new(10, 3, 0);
        let forms: [&[u8]; 4] = [
            b"\x1b]52;c;?\x07",
            b"\x1b]52;;?\x1b\\",
            "\u{9d}52;p;?\u{9c}".as_bytes(),
            "\x1b]52;s;?\u{9c}".as_bytes(),
        ];
        for f in forms {
            t.feed(f);
        }
        t.feed(b"\x1b]52;c;aGk=\x07ok");
        assert_eq!(t.clipboard.reads_refused, 4);
        assert_eq!(t.clipboard.writes, ["aGk="]);
        assert_eq!(text(&t)[0], "ok");
    }

    #[test]
    fn a_combining_mark_joins_its_cell() {
        let mut t = Terminal::new(10, 3, 0);
        t.feed("e\u{301}x".as_bytes());
        assert_eq!(t.row(0)[0].g.text(), "e\u{301}");
        assert_eq!(t.row(0)[1].g, G::One('x'));
    }

    #[test]
    fn a_full_line_wraps_only_when_the_next_character_comes() {
        let mut t = Terminal::new(3, 3, 0);
        t.feed(b"abc");
        assert_eq!(t.cursor(), (2, 0));
        t.feed(b"\r\n");
        assert_eq!(text(&t), ["abc", "", ""]);
        t.feed(b"abcd");
        assert_eq!(text(&t), ["abc", "abc", "d"]);
    }
}
