//! Issue #223: the stream table of data layout `streams@1` (canvas primitives: Vector field; Frame
//! and group: warp). An item that integrates a field writes one, its field's formula with its
//! vars' values, its step and each stream's points, and a group's warp flows along it reading the
//! table by this layout, never by the kind that built it. The core holds the layout so a build
//! without the data module still reads it; the sandbox's validator checks the same bytes.

use crate::base64;

/// The layout's name in `data.layout@1`.
pub const LAYOUT: &str = "streams@1";

/// The most bytes a formula's text takes.
pub const MAX_TEXT: u32 = 4_096;
/// The most vars a table carries.
pub const MAX_VARS: u32 = 16;
/// The most streams, and the most points a stream holds.
pub const MAX_STREAMS: u32 = 4_096;
pub const MAX_POINTS: u32 = 65_536;

/// Where the variable-length part starts.
const BODY: usize = 32;

pub const DOC: &str = "A stream table (Vector field; Frame and group: warp), little-endian: magic `STRM` at 0, version u32 = 1 at 4, step f64 at 8 (finite, above 0), the field's x and y formula lengths u32 at 16 and 20 (each 1 to 4,096 bytes), var count u32 at 24 (at most 16), stream count u32 at 28 (at most 4,096); from 32 the x formula's then the y formula's UTF-8 text, then each var as a name length u32 (1 to 64), its name and its value f64, then each stream as a point count u32 (at most 65,536) and its points as x, y f64 pairs; every number finite, and nothing after the last stream.";

/// A stream table: the field `(x, y) ↦ (fn_x, fn_y)` with its vars' values, the step it was
/// integrated at, and each stream's points.
#[derive(Clone, Debug, PartialEq)]
pub struct Table {
    pub fn_x: String,
    pub fn_y: String,
    pub vars: Vec<(String, f64)>,
    pub step: f64,
    pub streams: Vec<Vec<[f64; 2]>>,
}

pub fn encode(t: &Table) -> Vec<u8> {
    let mut w = b"STRM".to_vec();
    w.extend(1u32.to_le_bytes());
    w.extend(t.step.to_le_bytes());
    w.extend((t.fn_x.len() as u32).to_le_bytes());
    w.extend((t.fn_y.len() as u32).to_le_bytes());
    w.extend((t.vars.len() as u32).to_le_bytes());
    w.extend((t.streams.len() as u32).to_le_bytes());
    w.extend(t.fn_x.as_bytes());
    w.extend(t.fn_y.as_bytes());
    for (name, v) in &t.vars {
        w.extend((name.len() as u32).to_le_bytes());
        w.extend(name.as_bytes());
        w.extend(v.to_le_bytes());
    }
    for s in &t.streams {
        w.extend((s.len() as u32).to_le_bytes());
        for p in s {
            w.extend(p[0].to_le_bytes());
            w.extend(p[1].to_le_bytes());
        }
    }
    w
}

/// The table as an item's lowered params carry it: `{layout: "streams@1", bytes: <base64>}`.
pub fn to_json(t: &Table) -> serde_json::Value {
    serde_json::json!({"layout": LAYOUT, "bytes": base64::encode(&encode(t))})
}

/// A table read from the JSON [`to_json`] writes; `None` when it is in another layout or isn't one.
pub fn from_json(v: &serde_json::Value) -> Option<Table> {
    if v.get("layout")?.as_str()? != LAYOUT {
        return None;
    }
    decode(&base64::decode(v.get("bytes")?.as_str()?)?).ok()
}

struct Reader<'a> {
    b: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], usize> {
        let end = self
            .at
            .checked_add(n)
            .filter(|e| *e <= self.b.len())
            .ok_or(self.at)?;
        let s = &self.b[self.at..end];
        self.at = end;
        Ok(s)
    }
    fn u32(&mut self) -> Result<u32, usize> {
        let s = self.take(4)?;
        Ok(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
    }
    fn f64(&mut self) -> Result<f64, usize> {
        let at = self.at;
        let s = self.take(8)?;
        let mut a = [0u8; 8];
        a.copy_from_slice(s);
        let v = f64::from_le_bytes(a);
        if v.is_finite() {
            Ok(v)
        } else {
            Err(at)
        }
    }
    fn text(&mut self, n: u32) -> Result<String, usize> {
        let at = self.at;
        let s = self.take(n as usize)?;
        String::from_utf8(s.to_vec()).map_err(|_| at)
    }
}

/// The table in `bytes`, or the offset of the first byte that breaks the layout.
pub fn decode(bytes: &[u8]) -> Result<Table, usize> {
    let mut r = Reader { b: bytes, at: 0 };
    if r.take(4)? != b"STRM" {
        return Err(0);
    }
    if r.u32()? != 1 {
        return Err(4);
    }
    let step = r.f64()?;
    if step <= 0.0 {
        return Err(8);
    }
    let field =
        |at: usize, v: u32, lo: u32, hi: u32| if v < lo || v > hi { Err(at) } else { Ok(v) };
    let nx = field(16, r.u32()?, 1, MAX_TEXT)?;
    let ny = field(20, r.u32()?, 1, MAX_TEXT)?;
    let nv = field(24, r.u32()?, 0, MAX_VARS)?;
    let ns = field(28, r.u32()?, 0, MAX_STREAMS)?;
    debug_assert_eq!(r.at, BODY);
    let fn_x = r.text(nx)?;
    let fn_y = r.text(ny)?;
    let mut vars = Vec::new();
    for _ in 0..nv {
        let at = r.at;
        let n = field(at, r.u32()?, 1, 64)?;
        let name = r.text(n)?;
        vars.push((name, r.f64()?));
    }
    let mut streams = Vec::new();
    for _ in 0..ns {
        let at = r.at;
        let n = field(at, r.u32()?, 0, MAX_POINTS)?;
        let mut s = Vec::with_capacity(n as usize);
        for _ in 0..n {
            s.push([r.f64()?, r.f64()?]);
        }
        streams.push(s);
    }
    if r.at != bytes.len() {
        return Err(r.at);
    }
    Ok(Table {
        fn_x,
        fn_y,
        vars,
        step,
        streams,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table() -> Table {
        Table {
            fn_x: "-y".into(),
            fn_y: "x * k".into(),
            vars: vec![("k".into(), 1.0)],
            step: 0.01,
            streams: vec![vec![[1.0, 0.0], [0.99, 0.01]], vec![]],
        }
    }

    #[test]
    fn a_table_reads_back_as_written() {
        let t = table();
        assert_eq!(decode(&encode(&t)), Ok(t.clone()));
        assert_eq!(from_json(&to_json(&t)), Some(t));
    }

    #[test]
    fn a_broken_table_names_the_byte_that_breaks_it() {
        let good = encode(&table());
        let mut nan_step = good.clone();
        nan_step[8..16].copy_from_slice(&f64::NAN.to_le_bytes());
        assert_eq!(decode(&nan_step), Err(8));
        let mut trailing = good.clone();
        trailing.push(0);
        assert_eq!(decode(&trailing), Err(good.len()));
        let mut overrun = good.clone();
        overrun[28..32].copy_from_slice(&3u32.to_le_bytes());
        assert_eq!(
            decode(&overrun),
            Err(good.len()),
            "a third stream's count runs past the end"
        );
        let mut var = good;
        let v = BODY + 2 + 5 + 4 + 1;
        var[v..v + 8].copy_from_slice(&f64::INFINITY.to_le_bytes());
        assert_eq!(decode(&var), Err(v));
        let other = serde_json::json!({"layout": "fn.table@1", "bytes": ""});
        assert_eq!(
            from_json(&other),
            None,
            "a table in another layout isn't read as this one"
        );
    }
}
