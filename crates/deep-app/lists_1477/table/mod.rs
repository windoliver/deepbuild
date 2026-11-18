//! Issue #1477: the long table, one element. The toolkit's table builds an element per cell, thousands of
//! allocations a frame at 100,000 × 8; this one is a single layout box that finds its visible range in prepaint and
//! paints quads and shaped lines directly. Cells are typed values, formatted in a stack buffer, and only a cell marked
//! rich builds an element. A row's height is a function of its own record. Colors are the chrome's roles.

pub mod layout;
pub mod runs;
pub mod sort;
pub mod view;

use std::fmt::Write as _;

/// A cell's value. Text borrows from the rows, so reading a cell allocates nothing.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Value<'a> {
    Number(f64),
    Text(&'a str),
    Empty,
}

/// The rows a table shows: a panel passes them as data, so no script runs per frame.
pub trait Rows: Send + Sync + 'static {
    fn len(&self) -> usize;
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
    fn columns(&self) -> usize;
    fn cell(&self, row: usize, column: usize) -> Value<'_>;
    /// A row's height, from its own record only. `None` for a table of uniform rows.
    fn height(&self, _row: usize) -> Option<f64> {
        None
    }
    /// Whether a cell is rich, the only kind that builds an element.
    fn rich(&self, _row: usize, _column: usize) -> bool {
        false
    }
    /// Whether a row's cells are lines stacked down the row (a list), rather than columns across it.
    fn stacked(&self) -> bool {
        false
    }
}

/// A stack buffer a number is formatted into.
pub struct Buf {
    bytes: [u8; 64],
    len: usize,
}

impl Default for Buf {
    fn default() -> Self {
        Self {
            bytes: [0; 64],
            len: 0,
        }
    }
}

impl std::fmt::Write for Buf {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        let room = self.bytes.len() - self.len;
        let n = s.len().min(room);
        // Truncation can only cut ASCII here: numbers format as ASCII.
        self.bytes[self.len..self.len + n].copy_from_slice(&s.as_bytes()[..n]);
        self.len += n;
        Ok(())
    }
}

impl Buf {
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.bytes[..self.len]).unwrap_or("")
    }
}

/// The text a cell shows, numbers formatted into `buf`.
pub fn text<'a>(value: &Value<'a>, buf: &'a mut Buf) -> &'a str {
    match value {
        Value::Text(t) => t,
        Value::Empty => "",
        Value::Number(n) => {
            buf.len = 0;
            if n.is_finite() && n.fract() == 0. && n.abs() < 1e15 {
                let _ = write!(buf, "{}", *n as i64);
            } else {
                let _ = write!(buf, "{n}");
            }
            buf.as_str()
        }
    }
}
