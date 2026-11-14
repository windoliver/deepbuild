//! The pinned reference Lottie renderer (issue #162; canvas primitives: Export: Lottie): reads a
//! written Lottie file and renders the frames asked for, as straight-alpha RGBA rows, top-down,
//! at the size asked for. It runs in its own process, so the export's fidelity check reads the
//! file with a tool its writer doesn't control.

use std::io::Write;

use thorvg::{ColorSpace, EngineOption, Paint, Picture, Thorvg};

/// The engine the reader pins, as the receipt names it.
pub const ENGINE: &str = "thorvg 1.1.2 (thorvg-sys 0.4.0, thorvg 0.6.0), drawn at 2x and box-filtered";

/// How many times the size the engine draws at before each frame is box-filtered down: 2, or 1
/// for a frame over about 8 million pixels drawn twice as large. The engine snaps an axis-aligned rectangle's
/// edges to whole pixels, which a sub-pixel motion then misses by up to half a pixel; drawn larger
/// and filtered, it misses by a fraction of that.
pub fn supersample(w: u32, h: u32) -> u32 {
    let area = u64::from(w.max(1)) * u64::from(h.max(1));
    if area * 4 <= 8_000_000 { 2 } else { 1 }
}

/// Renders `frames` of the Lottie file at `path` at `w` × `h`, each frame's straight-alpha RGBA
/// bytes in turn, drawn at [`supersample`] times the size and box-filtered down.
pub fn render(path: &str, w: u32, h: u32, frames: &[f32]) -> Result<Vec<Vec<u8>>, String> {
    let f = supersample(w, h);
    let big = render_at(path, w * f, h * f, frames)?;
    Ok(big.into_iter().map(|b| down(&b, w, h, f)).collect())
}

/// A frame `f` times larger, box-filtered to `w` × `h`: premultiplied means, straight again.
fn down(big: &[u8], w: u32, h: u32, f: u32) -> Vec<u8> {
    if f == 1 {
        return big.to_vec();
    }
    let (w, h, f) = (w as usize, h as usize, f as usize);
    let bw = w * f;
    let n = (f * f) as u32;
    let mut out = vec![0u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let mut acc = [0u32; 4];
            for v in 0..f {
                for u in 0..f {
                    let i = ((y * f + v) * bw + x * f + u) * 4;
                    let a = u32::from(big[i + 3]);
                    for c in 0..3 {
                        acc[c] += u32::from(big[i + c]) * a;
                    }
                    acc[3] += a;
                }
            }
            let o = (y * w + x) * 4;
            if acc[3] > 0 {
                for c in 0..3 {
                    out[o + c] = ((acc[c] + acc[3] / 2) / acc[3]) as u8;
                }
            }
            out[o + 3] = ((acc[3] + n / 2) / n) as u8;
        }
    }
    out
}

fn render_at(path: &str, w: u32, h: u32, frames: &[f32]) -> Result<Vec<Vec<u8>>, String> {
    let engine = Thorvg::init().map_err(|e| format!("the engine didn't start: {e:?}"))?;
    let mut anim = engine.lottie_animation().map_err(|e| format!("{e:?}"))?;
    anim.load_file(path)
        .map_err(|e| format!("the file didn't load: {e:?}"))?;
    anim.set_size(w as f32, h as f32)
        .map_err(|e| format!("{e:?}"))?;
    let mut buf = vec![0u32; (w * h) as usize];
    let mut canvas = engine
        .sw_canvas(EngineOption::Default)
        .map_err(|e| format!("{e:?}"))?;
    // SAFETY: `buf` outlives `canvas`, which is dropped before it at the end of this function,
    // and is neither moved nor resized while the canvas holds it.
    unsafe { canvas.set_target(&mut buf, w, w, h, ColorSpace::ABGR8888S) }
        .map_err(|e| format!("{e:?}"))?;
    // SAFETY: the canvas takes a reference to the animation's picture, which the animation keeps
    // alive until after the canvas is dropped (declared after it, dropped first).
    let picture: Picture = unsafe { <Picture as Paint>::from_raw_paint(anim.picture().raw()) };
    canvas.add(picture).map_err(|e| format!("{e:?}"))?;
    let mut out = Vec::with_capacity(frames.len());
    for &f in frames {
        // Setting the frame it already shows reports no change; that isn't a failure.
        let _ = anim.set_frame(f);
        let _ = canvas.update();
        canvas
            .draw(true)
            .map_err(|e| format!("frame {f} didn't draw: {e:?}"))?;
        canvas
            .sync()
            .map_err(|e| format!("frame {f} didn't finish: {e:?}"))?;
        out.push(buf.iter().flat_map(|p| p.to_le_bytes()).collect());
    }
    drop(canvas);
    Ok(out)
}

/// `lottie-reader <path> <w> <h> <frame>,<frame>,…`: the frames' RGBA bytes on stdout, in turn.
pub fn serve(args: &[String]) -> i32 {
    let run = || -> Result<(), String> {
        let [path, w, h, list] = args else {
            return Err("usage: lottie-reader <path> <w> <h> <frames>".into());
        };
        let w: u32 = w.parse().map_err(|_| "a width")?;
        let h: u32 = h.parse().map_err(|_| "a height")?;
        let frames: Vec<f32> = list
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.parse().map_err(|_| format!("frame {s}")))
            .collect::<Result<_, _>>()?;
        let out = render(path, w, h, &frames)?;
        let mut stdout = std::io::stdout().lock();
        for f in out {
            stdout.write_all(&f).map_err(|e| e.to_string())?;
        }
        stdout.flush().map_err(|e| e.to_string())
    };
    match run() {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("lottie-reader: {e}");
            1
        }
    }
}
