//! IES distributions (#446; canvas primitives: Light: IES distribution): an LM-63-2002 file parsed
//! once per hash into an angular table whose mean over the sphere is 1, so a lamp's power stays
//! its flux and the file only shapes where it goes.

use std::f64::consts::{PI, TAU};

use deep_canvas::ops;

/// The table's columns, by azimuth from the light's +X, and rows, by angle from its axis.
pub const WIDTH: usize = 256;
pub const HEIGHT: usize = 128;
/// `budget.distributions`' ceiling per document.
pub const MOST: usize = 16;

/// One file as the renderer reads it.
#[derive(Clone, Debug, PartialEq)]
pub struct Distribution {
    pub sha: String,
    /// The lumens the file states: lamps × lumens per lamp, or under absolute photometry (lumens
    /// −1) its candela integrated over the sphere.
    pub lumens: f64,
    /// `WIDTH × HEIGHT` values, row by row from the axis; the sum of value × solid angle over the
    /// cells is 4π, so a lamp's intensity times its value at a direction keeps its flux.
    pub table: Vec<f32>,
}

impl Distribution {
    /// The share of its flux within `cos_outer` of its axis, which a spot keeps of the file.
    pub fn share(&self, cos_outer: f64) -> f64 {
        let outer = ops::acos(cos_outer.clamp(-1.0, 1.0));
        let mut sum = 0.0;
        for j in 0..HEIGHT {
            let (a, b) = (
                j as f64 * PI / HEIGHT as f64,
                (j + 1) as f64 * PI / HEIGHT as f64,
            );
            if a >= outer {
                break;
            }
            let row: f64 = self.table[j * WIDTH..(j + 1) * WIDTH]
                .iter()
                .map(|v| f64::from(*v))
                .sum();
            sum += row * (TAU / WIDTH as f64) * (ops::cos(a) - ops::cos(b.min(outer)));
        }
        sum / (4.0 * PI)
    }
}

impl Distribution {
    /// Its mean over a one-sided Lambertian face's emission, ∫ value × cos θ dω ÷ π over the
    /// hemisphere the face looks into, which an area light divides by to keep its flux.
    pub fn over_face(&self) -> f64 {
        let mut sum = 0.0;
        for j in 0..HEIGHT / 2 {
            let (a, b) = (
                j as f64 * PI / HEIGHT as f64,
                (j + 1) as f64 * PI / HEIGHT as f64,
            );
            let row: f64 = self.table[j * WIDTH..(j + 1) * WIDTH]
                .iter()
                .map(|v| f64::from(*v))
                .sum();
            // ∫ cos θ sin θ dθ across the row, times its cell's azimuth.
            sum += row
                * (TAU / WIDTH as f64)
                * 0.5
                * (ops::powi(ops::cos(a), 2) - ops::powi(ops::cos(b), 2));
        }
        sum / PI
    }
}

/// A photometric file's angles and candela, type C: vertical 0 along the light's axis.
struct File {
    vertical: Vec<f64>,
    horizontal: Vec<f64>,
    /// `candela[h][v]`.
    candela: Vec<Vec<f64>>,
}

fn ascending(a: &[f64], lo: f64, hi: f64) -> bool {
    !a.is_empty() && a.windows(2).all(|w| w[0] < w[1]) && a[0] >= lo && a[a.len() - 1] <= hi
}

/// The interval of `a` holding `x` and how far along it, `None` outside.
fn bracket(a: &[f64], x: f64) -> Option<(usize, usize, f64)> {
    if x < a[0] || x > a[a.len() - 1] {
        return None;
    }
    let hi = a.partition_point(|v| *v < x).min(a.len() - 1);
    if hi == 0 {
        return Some((0, 0, 0.0));
    }
    Some((hi - 1, hi, (x - a[hi - 1]) / (a[hi] - a[hi - 1])))
}

impl File {
    /// An azimuth in the range the file covers, by the symmetry its last angle declares.
    fn fold(&self, phi: f64) -> f64 {
        let (first, last) = (
            self.horizontal[0],
            self.horizontal[self.horizontal.len() - 1],
        );
        let mirrored = if phi > 180.0 { 360.0 - phi } else { phi };
        match (first, last) {
            (_, l) if self.horizontal.len() == 1 || l == 0.0 => first,
            (_, 90.0) => {
                if mirrored > 90.0 {
                    180.0 - mirrored
                } else {
                    mirrored
                }
            }
            (_, 180.0) => mirrored,
            (90.0, 270.0) if phi < 90.0 => 180.0 - phi,
            (90.0, 270.0) if phi > 270.0 => 540.0 - phi,
            _ => phi,
        }
    }

    /// The candela toward `theta` degrees from the axis and `phi` degrees of azimuth.
    fn at(&self, theta: f64, phi: f64) -> f64 {
        let Some((v0, v1, tv)) = bracket(&self.vertical, theta) else {
            return 0.0;
        };
        let Some((h0, h1, th)) = bracket(&self.horizontal, self.fold(phi)) else {
            return 0.0;
        };
        let along = |h: usize| self.candela[h][v0] * (1.0 - tv) + self.candela[h][v1] * tv;
        along(h0) * (1.0 - th) + along(h1) * th
    }
}

/// `text` as a [`Distribution`]; the reason when it isn't a type C LM-63 file. A `TILT=` naming a
/// file is refused, since a distribution never loads from a path.
pub fn parse(sha: &str, text: &str) -> Result<Distribution, &'static str> {
    let at = text.find("TILT=").ok_or("no TILT line")?;
    let rest = &text[at + "TILT=".len()..];
    let end = rest.find(['\r', '\n']).unwrap_or(rest.len());
    let tilt = rest[..end].trim();
    let mut numbers = rest[end..]
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|s| !s.is_empty())
        .map(str::parse::<f64>);
    let mut next = move || -> Result<f64, &'static str> {
        match numbers.next() {
            Some(Ok(v)) if v.is_finite() => Ok(v),
            Some(_) => Err("a value that isn't a number"),
            None => Err("the file ends early"),
        }
    };
    match tilt {
        "NONE" => {}
        "INCLUDE" => {
            let _geometry = next()?;
            let pairs = next()?;
            if !(0.0..=10_000.0).contains(&pairs) {
                return Err("a tilt table of no size");
            }
            for _ in 0..2 * pairs as usize {
                next()?;
            }
        }
        _ => return Err("TILT names a file"),
    }
    let (lamps, per_lamp, multiplier) = (next()?, next()?, next()?);
    let (nv, nh) = (next()?, next()?);
    let photometric = next()?;
    for _ in 0..7 {
        next()?; // units, width, length, height, ballast, its factor, watts
    }
    if photometric != 1.0 {
        return Err("only type C photometry");
    }
    if !(1.0..=4096.0).contains(&nv) || !(1.0..=4096.0).contains(&nh) {
        return Err("no angles");
    }
    let (nv, nh) = (nv as usize, nh as usize);
    let mut read = |n: usize| (0..n).map(|_| next()).collect::<Result<Vec<_>, _>>();
    let vertical = read(nv)?;
    let horizontal = read(nh)?;
    let candela = (0..nh).map(|_| read(nv)).collect::<Result<Vec<_>, _>>()?;
    if !ascending(&vertical, 0.0, 180.0) || !ascending(&horizontal, 0.0, 360.0) {
        return Err("angles out of order");
    }
    if candela.iter().flatten().any(|c| *c < 0.0) {
        return Err("negative candela");
    }
    let file = File {
        vertical,
        horizontal,
        candela,
    };
    let mut cells = vec![0.0f64; WIDTH * HEIGHT];
    let mut total = 0.0;
    let d_phi = TAU / WIDTH as f64;
    for j in 0..HEIGHT {
        let (a, b) = (
            j as f64 * PI / HEIGHT as f64,
            (j + 1) as f64 * PI / HEIGHT as f64,
        );
        let theta = (j as f64 + 0.5) * 180.0 / HEIGHT as f64;
        let omega = d_phi * (ops::cos(a) - ops::cos(b));
        for i in 0..WIDTH {
            let phi = (i as f64 + 0.5) * 360.0 / WIDTH as f64;
            let c = file.at(theta, phi);
            cells[j * WIDTH + i] = c;
            total += c * omega;
        }
    }
    if total <= 0.0 {
        return Err("no light");
    }
    let lumens = if per_lamp < 0.0 {
        total * multiplier
    } else {
        lamps * per_lamp
    };
    let scale = 4.0 * PI / total;
    Ok(Distribution {
        sha: sha.to_string(),
        lumens,
        table: cells.iter().map(|c| (c * scale) as f32).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEAD: &str = "IESNA:LM-63-2002\n[TEST] x\nTILT=NONE\n";

    fn integral(d: &Distribution) -> f64 {
        d.share(-1.0) * 4.0 * PI
    }

    #[test]
    fn a_uniform_file_reads_one_everywhere_and_states_its_lumens() {
        let text = format!("{HEAD}1 1000 1 3 1 1 2 0 0 0\n1 1 40\n0 90 180\n0\n318 318 318\n");
        let d = parse("a", &text).unwrap();
        assert_eq!(d.lumens, 1000.0);
        assert!(d.table.iter().all(|v| (*v - 1.0).abs() < 1e-4));
    }

    #[test]
    fn a_downlight_keeps_its_flux_and_says_how_much_a_cone_holds() {
        // All the light within 30° of the axis, falling off in cos².
        let text = format!("{HEAD}1 -1 1 4 1 1 2 0 0 0\n1 1 40\n0 15 30 180\n0\n1000 870 0 0\n");
        let d = parse("a", &text).unwrap();
        assert!((integral(&d) - 4.0 * PI).abs() < 1e-6);
        assert!(d.share(30f64.to_radians().cos()) > 0.99);
        assert!(d.share(10f64.to_radians().cos()) < 0.7);
        assert!(
            d.lumens > 100.0,
            "absolute photometry integrates: {}",
            d.lumens
        );
    }

    #[test]
    fn quadrant_symmetry_mirrors_the_azimuths() {
        let text = format!(
            "{HEAD}1 1000 1 2 3 1 2 0 0 0\n1 1 40\n0 90\n0 45 90\n100 100\n200 200\n300 300\n"
        );
        let d = parse("a", &text).unwrap();
        let at = |phi: f64| {
            let i = (phi / 360.0 * WIDTH as f64) as usize;
            d.table[(HEIGHT / 2 - 1) * WIDTH + i]
        };
        assert!((at(10.0) - at(170.0)).abs() < 1e-3);
        assert!((at(10.0) - at(350.0)).abs() < 1e-3);
        assert!(at(80.0) > at(10.0));
    }

    #[test]
    fn a_uniform_table_leaves_a_face_as_it_is() {
        let text = format!("{HEAD}1 1000 1 3 1 1 2 0 0 0\n1 1 40\n0 90 180\n0\n318 318 318\n");
        let d = parse("a", &text).unwrap();
        assert!((d.over_face() - 1.0).abs() < 1e-3, "{}", d.over_face());
    }

    #[test]
    fn a_tilt_naming_a_file_and_other_photometry_are_refused() {
        let named =
            "IESNA:LM-63-2002\nTILT=/etc/passwd\n1 1000 1 1 1 1 2 0 0 0\n1 1 40\n0\n0\n100\n";
        assert_eq!(parse("a", named), Err("TILT names a file"));
        let typed = format!("{HEAD}1 1000 1 1 1 2 2 0 0 0\n1 1 40\n0\n0\n100\n");
        assert_eq!(parse("a", &typed), Err("only type C photometry"));
    }
}
