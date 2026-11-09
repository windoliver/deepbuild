//! Issue #1477: where each row sits. Offsets are f64, so the last of 1,000,000 rows of 32 px still sits within
//! 0.5 px of its exact top (an f32 is off by whole pixels past 2^24). A row's height is a function of its own record,
//! summed in a Fenwick tree, so a remeasure costs log n. The scroll position is an anchor, a row and the distance
//! scrolled into it, so remeasuring a row above the viewport moves nothing on screen.

/// Row heights and their running sums.
pub struct Heights {
    heights: Vec<f64>,
    tree: Vec<f64>,
    uniform: Option<f64>,
    rows: usize,
}

impl Heights {
    /// `rows` rows all `height` tall, held as one number.
    pub fn uniform(rows: usize, height: f64) -> Self {
        Self {
            heights: Vec::new(),
            tree: Vec::new(),
            uniform: Some(sane(height)),
            rows,
        }
    }

    /// One height per row, each from its own record.
    pub fn from_fn(rows: usize, height: impl Fn(usize) -> f64) -> Self {
        let heights: Vec<f64> = (0..rows).map(|r| sane(height(r))).collect();
        // A 1-based Fenwick tree stored from 0: entry k - 1 sums the `k & k.wrapping_neg()` rows ending at row k - 1.
        let mut tree = heights.clone();
        for k in 1..=rows {
            let parent = k + (k & k.wrapping_neg());
            if parent <= rows {
                tree[parent - 1] += tree[k - 1];
            }
        }
        Self {
            heights,
            tree,
            uniform: None,
            rows,
        }
    }

    pub fn rows(&self) -> usize {
        self.rows
    }

    pub fn height(&self, row: usize) -> f64 {
        match self.uniform {
            Some(h) => h,
            None => self.heights[row],
        }
    }

    /// The top of `row`: the sum of the heights above it.
    pub fn top(&self, row: usize) -> f64 {
        if let Some(h) = self.uniform {
            return row.min(self.rows()) as f64 * h;
        }
        let mut sum = 0.;
        let mut i = row.min(self.heights.len());
        while i > 0 {
            sum += self.tree[i - 1];
            i &= i - 1;
        }
        sum
    }

    pub fn total(&self) -> f64 {
        self.top(self.rows())
    }

    /// Sets a row's height; the rows below it move, the rows above don't.
    pub fn set(&mut self, row: usize, height: f64) {
        if self.uniform.is_some() || row >= self.heights.len() {
            return;
        }
        let height = sane(height);
        let delta = height - self.heights[row];
        self.heights[row] = height;
        let mut k = row + 1;
        while k <= self.tree.len() {
            self.tree[k - 1] += delta;
            k += k & k.wrapping_neg();
        }
    }

    /// The row whose span holds offset `y` (the last row past the end), and how far into it `y` is.
    pub fn at(&self, y: f64) -> (usize, f64) {
        let rows = self.rows();
        if rows == 0 {
            return (0, 0.);
        }
        let y = if y.is_finite() { y.max(0.) } else { 0. };
        if let Some(h) = self.uniform {
            if h <= 0. {
                return (0, 0.);
            }
            let row = ((y / h).floor() as usize).min(rows - 1);
            return (row, y - row as f64 * h);
        }
        // Descend the Fenwick tree for the last prefix not past y.
        let mut pos = 0usize;
        let mut rest = y;
        let mut step = rows.next_power_of_two();
        while step > 0 {
            let next = pos + step;
            if next <= rows && self.tree[next - 1] <= rest {
                pos = next;
                rest -= self.tree[next - 1];
            }
            step >>= 1;
        }
        if pos >= rows {
            let last = rows - 1;
            return (last, self.height(last));
        }
        (pos, rest)
    }
}

/// A height no record can make hostile: NaN, infinite and negative heights are 0.
fn sane(h: f64) -> f64 {
    if h.is_finite() && h > 0. {
        h.min(1e7)
    } else {
        0.
    }
}

/// The scroll position: the row at the viewport's top and how far it is scrolled into.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Anchor {
    pub row: usize,
    pub into: f64,
}

impl Anchor {
    /// The viewport's top as an offset.
    pub fn offset(&self, heights: &Heights) -> f64 {
        heights.top(self.row) + self.into
    }

    /// Scrolls by `dy` (down when positive) inside a viewport `viewport` tall. NaN and infinite scrolls move nothing.
    pub fn scroll(&mut self, dy: f64, viewport: f64, heights: &Heights) {
        if !dy.is_finite() {
            return;
        }
        let max = (heights.total() - viewport.max(0.)).max(0.);
        let to = (self.offset(heights) + dy).clamp(0., max);
        self.set(to, heights);
    }

    /// Puts the viewport's top at `y`.
    pub fn set(&mut self, y: f64, heights: &Heights) {
        let (row, into) = heights.at(y);
        *self = Self { row, into };
    }

    /// Keeps the anchor in range after the rows changed.
    pub fn clamp(&mut self, heights: &Heights) {
        let rows = heights.rows();
        if rows == 0 {
            *self = Self::default();
        } else if self.row >= rows {
            self.set(heights.total(), heights);
        } else {
            self.into = self.into.clamp(0., heights.height(self.row));
        }
    }
}
