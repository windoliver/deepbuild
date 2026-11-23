//! Issue #1592: a status mark drawn in its slot, as an SVG and as the samples its shape covers.

use super::*;

impl Marks {
    /// A state's mark as an SVG drawn in one color, the state's: its core and its line, with its cut masked out of both.
    pub fn svg(&self, state: &str) -> Option<String> {
        let drawn = self.drawn.get(state)?;
        let (slot, stroke) = (self.slot, self.stroke);
        let stroked = |d: &str, ink: &str| {
            format!(
                r#"<path d="{d}" fill="none" stroke="{ink}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round"/>"#
            )
        };
        let mut body = String::new();
        if let Some(core) = &drawn.core {
            body.push_str(&format!(r#"<path d="{core}" fill-rule="evenodd"/>"#));
        }
        if let Some(line) = &drawn.line {
            body.push_str(&stroked(line, "black"));
        }
        let (defs, group) = match &drawn.cut {
            None => (String::new(), "<g>"),
            Some(cut) => (
                format!(
                    r#"<defs><mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="{slot}" height="{slot}"><rect width="{slot}" height="{slot}" fill="white"/>{}</mask></defs>"#,
                    stroked(cut, "black")
                ),
                r#"<g mask="url(#cut)">"#,
            ),
        };
        Some(format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="{slot}" height="{slot}" viewBox="0 0 {slot} {slot}">{defs}{group}{body}</g></svg>"#
        ))
    }

    /// Which of a state's samples its mark covers, [`MARK_SAMPLES`] to a side, row by row: inside its core by the
    /// even-odd rule or within half a stroke of its line, and farther than half a stroke from its cut. The shape alone,
    /// as with color off.
    pub fn coverage(&self, state: &str) -> Option<Vec<bool>> {
        let drawn = self.drawn.get(state)?;
        let tol = self.slot / 512.0;
        let read = |d: &Option<String>| -> Option<Vec<path::Polyline>> {
            match d {
                Some(d) => Some(path::flatten(&path::parse(d)?, tol)),
                None => Some(Vec::new()),
            }
        };
        let (core, line, cut) = (read(&drawn.core)?, read(&drawn.line)?, read(&drawn.cut)?);
        let reach = self.stroke * self.stroke / 4.0;
        let step = self.slot / MARK_SAMPLES as f64;
        let mut covered = Vec::with_capacity(MARK_SAMPLES * MARK_SAMPLES);
        for row in 0..MARK_SAMPLES {
            for column in 0..MARK_SAMPLES {
                let p = [(column as f64 + 0.5) * step, (row as f64 + 0.5) * step];
                let inked = inside(&core, p) || line.iter().any(|l| near(l, p, reach));
                covered.push(inked && !cut.iter().any(|l| near(l, p, reach)));
            }
        }
        Some(covered)
    }
}

/// Whether `p` is inside the polylines, each closed, by the even-odd rule.
fn inside(lines: &[path::Polyline], p: [f64; 2]) -> bool {
    let mut odd = false;
    for line in lines {
        let points = &line.points;
        for (i, a) in points.iter().enumerate() {
            let b = points[(i + 1) % points.len()];
            if (a[1] > p[1]) != (b[1] > p[1]) {
                let x = a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
                if p[0] < x {
                    odd = !odd;
                }
            }
        }
    }
    odd
}

/// Whether `p` is within `reach`, a squared distance, of the polyline, its closing segment included when it closes.
fn near(line: &path::Polyline, p: [f64; 2], reach: f64) -> bool {
    let points = &line.points;
    let closing = line.closed.then(|| (points[points.len() - 1], points[0]));
    let mut segments = points.windows(2).map(|w| (w[0], w[1])).chain(closing);
    segments.any(|(a, b)| {
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let long = dx * dx + dy * dy;
        let t = if long == 0.0 {
            0.0
        } else {
            (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / long).clamp(0.0, 1.0)
        };
        let (ex, ey) = (a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
        ex * ex + ey * ey <= reach
    })
}
