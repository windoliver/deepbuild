//! Reading a packed catalog by hash, as a logic program does: a table by its name's hash, a column
//! by its name's hash, a row by a binary search on its ID's hash.

use crate::fnv1a;

/// One column's directory entry.
#[derive(Clone, Copy, Debug)]
pub struct Column {
    pub name_hash: u32,
    pub ty: u32,
    pub at: usize,
    pub target: u32,
}

/// One table's directory entry and its columns.
#[derive(Clone, Debug)]
pub struct Table {
    pub name_hash: u32,
    pub rows: usize,
    pub columns: Vec<Column>,
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// The directory of a `table.layout@1` asset, or None when its header or directory doesn't read.
pub fn directory(b: &[u8]) -> Option<Vec<Table>> {
    if b.get(0..4)? != crate::MAGIC || u32_at(b, 4)? != crate::VERSION {
        return None;
    }
    let count = u32_at(b, 8)? as usize;
    if count > crate::MAX_TABLES {
        return None;
    }
    let mut p = crate::HEADER;
    let mut out = Vec::new();
    for _ in 0..count {
        let (name_hash, rows, cc) = (
            u32_at(b, p)?,
            u32_at(b, p + 4)? as usize,
            u32_at(b, p + 8)? as usize,
        );
        p += crate::TABLE_ENTRY;
        let mut columns = Vec::new();
        for _ in 0..cc.min(crate::MAX_COLUMNS) {
            columns.push(Column {
                name_hash: u32_at(b, p)?,
                ty: u32_at(b, p + 4)?,
                at: u32_at(b, p + 8)? as usize,
                target: u32_at(b, p + 12)?,
            });
            p += crate::COLUMN_ENTRY;
        }
        out.push(Table {
            name_hash,
            rows,
            columns,
        });
    }
    Some(out)
}

impl Table {
    pub fn column(&self, name: &str) -> Option<Column> {
        let h = fnv1a(name);
        self.columns.iter().copied().find(|c| c.name_hash == h)
    }
    /// The row whose ID column `id_column` holds `id`'s hash, by binary search.
    pub fn row(&self, b: &[u8], id_column: &str, id: &str) -> Option<usize> {
        let col = self.column(id_column)?;
        let want = fnv1a(id);
        let (mut lo, mut hi) = (0usize, self.rows);
        while lo < hi {
            let mid = (lo + hi) / 2;
            let h = u32_at(b, col.at + 4 * mid)?;
            match h.cmp(&want) {
                std::cmp::Ordering::Equal => return Some(mid),
                std::cmp::Ordering::Less => lo = mid + 1,
                std::cmp::Ordering::Greater => hi = mid,
            }
        }
        None
    }
}

/// The table named `name` in a directory.
pub fn table<'a>(dir: &'a [Table], name: &str) -> Option<&'a Table> {
    let h = fnv1a(name);
    dir.iter().find(|t| t.name_hash == h)
}

/// The f64 at `row` of an f64 column.
pub fn f64_at(b: &[u8], c: Column, row: usize) -> Option<f64> {
    let at = c.at + 8 * row;
    Some(f64::from_le_bytes(b.get(at..at + 8)?.try_into().ok()?))
}

/// Writes `v` at `row` of an f64 column in place.
pub fn set_f64(b: &mut [u8], c: Column, row: usize, v: f64) -> Option<()> {
    let at = c.at + 8 * row;
    b.get_mut(at..at + 8)?.copy_from_slice(&v.to_le_bytes());
    Some(())
}
