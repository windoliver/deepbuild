//! An animated GIF, WebP or APNG as a frame source (Image `image@1`, #1489): each frame's delay read
//! from the file's own blocks without decoding a pixel, the frame at a source time read from those
//! delays, and the frames composited one at a time, in order, onto one canvas. A frame source
//! holds the frame shown and its canvas, which runs one frame ahead; a frame before the canvas
//! restarts it from the top and skips forward, so a seek shows what playing shows.

use std::io::Cursor;
use std::sync::Arc;

use crate::source::{fits, refused, Refused, DECODE_CAP};

/// Flicks a second: the document's clock.
pub const FLICKS: i64 = 705_600_000;

/// A frame whose delay is this or less shows for [`SHOWN_FOR`], flicks: 10 ms and 100 ms.
pub const SHORTEST: i64 = FLICKS / 100;
pub const SHOWN_FOR: i64 = FLICKS / 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Gif,
    Webp,
    Apng,
}

/// What a probe reads of an animation: its format, its canvas in px and when each frame starts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Animation {
    pub format: Format,
    pub size: [u32; 2],
    /// Each frame's start from the animation's, flicks, then its length.
    starts: Vec<i64>,
}

impl Animation {
    fn new(format: Format, size: [u32; 2], delays: &[i64]) -> Option<Animation> {
        if delays.len() < 2 || size[0] == 0 || size[1] == 0 {
            return None;
        }
        let mut starts = Vec::with_capacity(delays.len() + 1);
        let mut at = 0i64;
        starts.push(0);
        for d in delays {
            at = at.saturating_add(if *d <= SHORTEST { SHOWN_FOR } else { *d });
            starts.push(at);
        }
        Some(Animation {
            format,
            size,
            starts,
        })
    }

    /// How many frames it has.
    pub fn frames(&self) -> usize {
        self.starts.len() - 1
    }

    /// Its length, flicks: the sum of its frames' delays as shown.
    pub fn length(&self) -> i64 {
        self.starts[self.frames()]
    }

    /// Frame `k`'s delay as shown, flicks.
    pub fn delay(&self, k: usize) -> i64 {
        self.starts[k + 1] - self.starts[k]
    }

    /// The frame shown at `src`, flicks from the animation's start: the first before it, and past
    /// its end the first again while it loops, else the frame `hold_first` names.
    pub fn frame_at(&self, src: i64, looped: bool, hold_first: bool) -> usize {
        let len = self.length();
        let src = match src {
            s if s < 0 => 0,
            s if s >= len && looped => s.rem_euclid(len),
            s if s >= len => return if hold_first { 0 } else { self.frames() - 1 },
            s => s,
        };
        self.starts.partition_point(|s| *s <= src) - 1
    }

    /// The first source time after `src` at which another frame shows, if one ever does.
    pub fn next_change(&self, src: i64, looped: bool, hold_first: bool) -> Option<i64> {
        let len = self.length();
        if src < 0 {
            return Some(self.starts[1]);
        }
        if src >= len && !looped {
            return None;
        }
        let lap = src.div_euclid(len) * len;
        let k = self.frame_at(src, looped, hold_first);
        let end = lap + self.starts[k + 1];
        let last = k + 1 == self.frames();
        // A held last frame never changes; a held first frame shows once the end is reached.
        (looped || !last || hold_first).then_some(end)
    }
}

fn u16le(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(u16::from_le_bytes(
        b.get(at..at + 2)?.try_into().ok()?,
    )))
}

fn u24le(b: &[u8], at: usize) -> Option<u32> {
    let s = b.get(at..at + 3)?;
    Some(u32::from(s[0]) | u32::from(s[1]) << 8 | u32::from(s[2]) << 16)
}

fn u32le(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn u32be(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

const PNG: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

/// Whether a file starting with `head` (12 bytes) is a GIF, a WebP or a PNG, the formats that may
/// animate.
pub fn may_animate(head: &[u8]) -> bool {
    head.starts_with(b"GIF8")
        || (head.get(..4) == Some(b"RIFF") && head.get(8..12) == Some(b"WEBP"))
        || head.starts_with(PNG)
}

/// `bytes` read as an animation of two frames or more; `None` for anything else, a still picture
/// in any format among them. Only blocks are read: no pixel is decoded.
pub fn probe(bytes: &[u8]) -> Option<Animation> {
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        gif_delays(bytes)
    } else if bytes.get(..4) == Some(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        webp_delays(bytes)
    } else if bytes.starts_with(PNG) {
        apng_delays(bytes)
    } else {
        None
    }
}

/// A GIF's frames, each with the delay its graphic control block gives (hundredths of a second),
/// read up to its trailer or the last whole frame.
fn gif_delays(b: &[u8]) -> Option<Animation> {
    let size = [u16le(b, 6)?, u16le(b, 8)?];
    let table = |packed: u8| {
        if packed & 0x80 != 0 {
            3 << ((packed & 7) + 1)
        } else {
            0
        }
    };
    let mut at = 13 + table(*b.get(10)?);
    // Sub-blocks from `at` to their terminator: where they end, and the first one.
    let blocks = |mut at: usize| -> Option<(usize, usize)> {
        let first = at;
        loop {
            let n = usize::from(*b.get(at)?);
            at += 1 + n;
            if n == 0 {
                return Some((at, first));
            }
        }
    };
    let (mut delays, mut pending) = (Vec::new(), 0);
    while let Some(&kind) = b.get(at) {
        match kind {
            0x21 => {
                let label = *b.get(at + 1)?;
                let Some((end, first)) = blocks(at + 2) else {
                    break;
                };
                if label == 0xF9 && b.get(first) == Some(&4) {
                    pending = u16le(b, first + 2)?;
                }
                at = end;
            }
            0x2C => {
                let packed = *b.get(at + 9)?;
                let Some((end, _)) = blocks(at + 10 + table(packed) + 1) else {
                    break;
                };
                delays.push(i64::from(pending) * (FLICKS / 100));
                pending = 0;
                at = end;
            }
            _ => break,
        }
    }
    Animation::new(Format::Gif, size, &delays)
}

/// An animated WebP's frames, each with its ANMF duration (ms); a still WebP is none.
fn webp_delays(b: &[u8]) -> Option<Animation> {
    let (mut at, mut size, mut animated, mut delays) = (12, None, false, Vec::new());
    while let (Some(id), Some(n)) = (b.get(at..at + 4), u32le(b, at + 4)) {
        let n = n as usize;
        let data = b.get(at + 8..at + 8 + n)?;
        match id {
            b"VP8X" => {
                animated = data.first()? & 0x02 != 0;
                size = Some([u24le(data, 4)? + 1, u24le(data, 7)? + 1]);
            }
            b"ANMF" => delays.push(i64::from(u24le(data, 12)?) * (FLICKS / 1000)),
            _ => {}
        }
        at += 8 + n + (n & 1);
    }
    animated.then_some(())?;
    Animation::new(Format::Webp, size?, &delays)
}

/// An APNG's frames, one per frame control chunk, each with its delay fraction of a second; a PNG
/// with no animation control chunk is a still picture.
fn apng_delays(b: &[u8]) -> Option<Animation> {
    let (mut at, mut size, mut animated, mut delays) = (8, None, false, Vec::new());
    while let (Some(n), Some(kind)) = (u32be(b, at), b.get(at + 4..at + 8)) {
        let n = n as usize;
        let data = b.get(at + 8..at + 8 + n)?;
        match kind {
            b"IHDR" => size = Some([u32be(data, 0)?, u32be(data, 4)?]),
            b"acTL" => animated = true,
            b"fcTL" => {
                let num = i64::from(u16::from_be_bytes(data.get(20..22)?.try_into().ok()?));
                let den = match u16::from_be_bytes(data.get(22..24)?.try_into().ok()?) {
                    0 => 100,
                    d => i64::from(d),
                };
                delays.push((num * FLICKS + den / 2) / den);
            }
            b"IEND" => break,
            _ => {}
        }
        at += 12 + n;
    }
    animated.then_some(())?;
    Animation::new(Format::Apng, size?, &delays)
}

fn undecodable<E>(_: E) -> Refused {
    refused("asset_undecodable")
}

/// A decoder standing at some frame, composited onto its canvas by the rules of its format.
enum Decoder {
    Gif {
        reader: Box<gif::Decoder<Cursor<Arc<[u8]>>>>,
        /// The last frame's rect and disposal, and what a "previous" disposal restores there.
        last: Option<([u32; 4], gif::DisposalMethod)>,
        saved: Vec<u8>,
    },
    Webp {
        reader: Box<image_webp::WebPDecoder<Cursor<Arc<[u8]>>>>,
    },
    Apng {
        reader: Box<png::Reader<Cursor<Arc<[u8]>>>>,
        /// Whether the next image is the default image, which isn't one of the frames.
        skip: bool,
        last: Option<([u32; 4], png::DisposeOp)>,
        saved: Vec<u8>,
    },
}

/// The pixels of `rect` (`[x, y, w, h]`) of a canvas `width` px wide, row by row.
fn cut(canvas: &[u8], width: u32, [x, y, w, h]: [u32; 4]) -> Vec<u8> {
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for row in y..y + h {
        let at = ((row * width + x) * 4) as usize;
        out.extend_from_slice(&canvas[at..at + (w * 4) as usize]);
    }
    out
}

/// Writes `pixels`, cut from `rect`, back into it, or clears it when `pixels` is empty.
fn paste(canvas: &mut [u8], width: u32, [x, y, w, h]: [u32; 4], pixels: &[u8]) {
    for (i, row) in (y..y + h).enumerate() {
        let at = ((row * width + x) * 4) as usize;
        let line = &mut canvas[at..at + (w * 4) as usize];
        match pixels.get(i * line.len()..(i + 1) * line.len()) {
            Some(from) => line.copy_from_slice(from),
            None => line.fill(0),
        }
    }
}

/// `[x, y, w, h]` kept inside a canvas of `size`.
fn clipped([x, y, w, h]: [u32; 4], size: [u32; 2]) -> [u32; 4] {
    let (x, y) = (x.min(size[0]), y.min(size[1]));
    [x, y, w.min(size[0] - x), h.min(size[1] - y)]
}

impl Decoder {
    fn open(bytes: &Arc<[u8]>, format: Format) -> Result<Decoder, Refused> {
        let cursor = Cursor::new(bytes.clone());
        Ok(match format {
            Format::Gif => {
                let mut options = gif::DecodeOptions::new();
                options.set_color_output(gif::ColorOutput::Indexed);
                if let Some(cap) = std::num::NonZeroU64::new(DECODE_CAP) {
                    options.set_memory_limit(gif::MemoryLimit::Bytes(cap));
                }
                Decoder::Gif {
                    reader: Box::new(options.read_info(cursor).map_err(undecodable)?),
                    last: None,
                    saved: Vec::new(),
                }
            }
            Format::Webp => Decoder::Webp {
                reader: Box::new(image_webp::WebPDecoder::new(cursor).map_err(undecodable)?),
            },
            Format::Apng => {
                let mut decoder = png::Decoder::new(cursor);
                decoder.set_transformations(
                    png::Transformations::EXPAND
                        | png::Transformations::STRIP_16
                        | png::Transformations::ALPHA,
                );
                let reader = decoder.read_info().map_err(undecodable)?;
                Decoder::Apng {
                    skip: reader.info().frame_control.is_none(),
                    reader: Box::new(reader),
                    last: None,
                    saved: Vec::new(),
                }
            }
        })
    }

    /// Composites the next frame onto `canvas` (straight RGBA at `size`).
    fn step(&mut self, canvas: &mut [u8], size: [u32; 2]) -> Result<(), Refused> {
        match self {
            Decoder::Gif {
                reader,
                last,
                saved,
            } => {
                // The last frame's disposal comes first.
                if let Some((rect, dispose)) = last.take() {
                    match dispose {
                        gif::DisposalMethod::Background => paste(canvas, size[0], rect, &[]),
                        gif::DisposalMethod::Previous => paste(canvas, size[0], rect, saved),
                        _ => {}
                    }
                }
                let frame = reader.next_frame_info().map_err(undecodable)?;
                let frame = frame.ok_or(refused("asset_undecodable"))?;
                let full = [
                    u32::from(frame.left),
                    u32::from(frame.top),
                    u32::from(frame.width),
                    u32::from(frame.height),
                ];
                let (transparent, dispose) = (frame.transparent, frame.dispose);
                let local = frame.palette.clone();
                let rect = clipped(full, size);
                *saved = match dispose {
                    gif::DisposalMethod::Previous => cut(canvas, size[0], rect),
                    _ => Vec::new(),
                };
                let mut indices = vec![0u8; reader.buffer_size()];
                reader.read_into_buffer(&mut indices).map_err(undecodable)?;
                let palette = local.as_deref().or(reader.global_palette()).unwrap_or(&[]);
                for row in 0..rect[3] {
                    for col in 0..rect[2] {
                        let i = indices[((row + rect[1] - full[1]) * full[2] + col + rect[0]
                            - full[0]) as usize];
                        let (Some(rgb), false) = (
                            palette.get(usize::from(i) * 3..usize::from(i) * 3 + 3),
                            transparent == Some(i),
                        ) else {
                            continue;
                        };
                        let at = (((row + rect[1]) * size[0] + col + rect[0]) * 4) as usize;
                        canvas[at..at + 3].copy_from_slice(rgb);
                        canvas[at + 3] = 255;
                    }
                }
                *last = Some((rect, dispose));
                Ok(())
            }
            Decoder::Webp { reader } => {
                if reader.has_alpha() {
                    reader.read_frame(canvas).map_err(undecodable)?;
                    return Ok(());
                }
                // A decode buffer of the frame's own, let go once composited, so it is never held.
                let mut rgb = vec![0u8; canvas.len() / 4 * 3];
                reader.read_frame(&mut rgb).map_err(undecodable)?;
                for (px, from) in
                    (canvas.as_chunks_mut::<4>().0.iter_mut()).zip(rgb.as_chunks::<3>().0)
                {
                    px[..3].copy_from_slice(from);
                    px[3] = 255;
                }
                Ok(())
            }
            Decoder::Apng {
                reader,
                skip,
                last,
                saved,
            } => {
                // A decode buffer of the frame's own, let go once composited, so it is never held.
                let room = reader.output_buffer_size().ok_or(refused("over_budget"))?;
                let mut raw = vec![0u8; room];
                if std::mem::take(skip) {
                    reader.next_frame(&mut raw).map_err(undecodable)?;
                }
                let first = last.is_none();
                if let Some((rect, dispose)) = last.take() {
                    match dispose {
                        png::DisposeOp::Background => paste(canvas, size[0], rect, &[]),
                        png::DisposeOp::Previous => paste(canvas, size[0], rect, saved),
                        png::DisposeOp::None => {}
                    }
                }
                let out = reader.next_frame(&mut raw).map_err(undecodable)?;
                let fc = reader.info().frame_control.unwrap_or_default();
                let full = [fc.x_offset, fc.y_offset, out.width, out.height];
                let rect = clipped(full, size);
                // A first frame that would restore what was before it clears instead.
                let dispose = match fc.dispose_op {
                    png::DisposeOp::Previous if first => png::DisposeOp::Background,
                    png::DisposeOp::Previous => {
                        *saved = cut(canvas, size[0], rect);
                        png::DisposeOp::Previous
                    }
                    op => op,
                };
                let channels = out.color_type.samples();
                for row in 0..rect[3] {
                    for col in 0..rect[2] {
                        let s = ((row * out.width + col) as usize) * channels;
                        let px = &raw[s..s + channels];
                        let src = match channels {
                            1 => [px[0], px[0], px[0], 255],
                            2 => [px[0], px[0], px[0], px[1]],
                            3 => [px[0], px[1], px[2], 255],
                            _ => [px[0], px[1], px[2], px[3]],
                        };
                        let at = (((row + rect[1]) * size[0] + col + rect[0]) * 4) as usize;
                        let dst = &mut canvas[at..at + 4];
                        if fc.blend_op == png::BlendOp::Source || src[3] == 255 {
                            dst.copy_from_slice(&src);
                        } else if src[3] > 0 {
                            over(dst, src);
                        }
                    }
                }
                *last = Some((rect, dispose));
                Ok(())
            }
        }
    }
}

/// Straight-alpha `src` composited over `dst` in place.
fn over(dst: &mut [u8], src: [u8; 4]) {
    let (sa, da) = (f32::from(src[3]) / 255.0, f32::from(dst[3]) / 255.0);
    let a = sa + da * (1.0 - sa);
    for c in 0..3 {
        let v = (f32::from(src[c]) * sa + f32::from(dst[c]) * da * (1.0 - sa)) / a;
        dst[c] = v.round().clamp(0.0, 255.0) as u8;
    }
    dst[3] = (a * 255.0).round() as u8;
}

// The service's workers share frame sources, so one moves between threads.
const _: fn() = || {
    fn send<T: Send>() {}
    send::<Player>();
};

/// One animation's frames, composited in order onto one canvas, which runs one frame ahead of the
/// frame shown. The frame shown is its caller's to keep (the image service keeps its level).
pub struct Player {
    bytes: Arc<[u8]>,
    pub animation: Animation,
    decoder: Option<Decoder>,
    canvas: Vec<u8>,
    /// The frame the canvas holds, if any.
    at: Option<usize>,
    /// The frame last read.
    shown: Option<usize>,
    /// #1489 AC1's wrong program: every frame, decoded up front and kept.
    every: Option<Vec<Vec<u8>>>,
}

impl Player {
    /// A frame source for `bytes`, if they are an animation that fits the decode caps.
    pub fn open(bytes: Arc<[u8]>, keeps_every_frame: bool) -> Result<Option<Player>, Refused> {
        let Some(animation) = probe(&bytes) else {
            return Ok(None);
        };
        if !fits(animation.size) {
            return Err(refused("over_budget"));
        }
        let mut player = Player {
            bytes,
            animation,
            decoder: None,
            canvas: Vec::new(),
            at: None,
            shown: None,
            every: keeps_every_frame.then(Vec::new),
        };
        // The wrong program decodes the whole animation up front and keeps every frame.
        if keeps_every_frame {
            for _ in 0..player.animation.frames() {
                player.step()?;
            }
        }
        Ok(Some(player))
    }

    /// Moves the canvas on by one frame, from the top when it holds none or the last.
    fn step(&mut self) -> Result<(), Refused> {
        let next = match self.at {
            Some(k) if k + 1 < self.animation.frames() => k + 1,
            _ => {
                self.decoder = Some(Decoder::open(&self.bytes, self.animation.format)?);
                let [w, h] = self.animation.size;
                self.canvas.clear();
                self.canvas.resize((w * h * 4) as usize, 0);
                0
            }
        };
        self.at = None;
        let decoder = self.decoder.as_mut().ok_or(refused("asset_undecodable"))?;
        decoder.step(&mut self.canvas, self.animation.size)?;
        self.at = Some(next);
        if let Some(every) = &mut self.every {
            every.push(self.canvas.clone());
        }
        Ok(())
    }

    /// Frame `k`'s picture, straight RGBA at the animation's size: the canvas moved on to it, from
    /// the top when it is past it.
    pub fn frame(&mut self, k: usize) -> Result<&[u8], Refused> {
        if k >= self.animation.frames() {
            return Err(refused("out_of_range"));
        }
        if self.every.is_some() {
            self.shown = Some(k);
            let every = self.every.as_deref().unwrap_or_default();
            return every
                .get(k)
                .map(Vec::as_slice)
                .ok_or(refused("out_of_range"));
        }
        if self.at.is_some_and(|a| a > k) {
            self.at = None;
        }
        while self.at != Some(k) {
            self.step()?;
        }
        self.shown = Some(k);
        Ok(&self.canvas)
    }

    /// Moves the canvas to the frame after the one last read, ahead of need: from the top after
    /// the last frame when `looped`.
    pub fn ahead(&mut self, looped: bool) -> Result<(), Refused> {
        let Some(k) = self.shown.filter(|_| self.every.is_none()) else {
            return Ok(());
        };
        let last = k + 1 == self.animation.frames();
        if self.at == Some(k) && (!last || looped) {
            self.step()?;
        }
        Ok(())
    }

    /// The bytes of pixels it holds: the canvas and what the decoder keeps of its own.
    pub fn held(&self) -> u64 {
        let every: usize = self.every.iter().flatten().map(Vec::len).sum();
        let decoder = match &self.decoder {
            Some(Decoder::Gif { saved, .. }) => saved.len(),
            Some(Decoder::Webp { reader }) => {
                (reader.dimensions().0 * reader.dimensions().1 * 4) as usize
            }
            Some(Decoder::Apng { saved, .. }) => saved.len(),
            None => 0,
        };
        (self.canvas.len() + every + decoder) as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A GIF of `frames` frames of `w` × `h`, frame k filled with palette color k, each shown for
    /// `cs` hundredths of a second.
    pub(crate) fn gif(w: u16, h: u16, frames: usize, cs: u16) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let palette: Vec<u8> = (0..256u32)
                .flat_map(|i| [i as u8, (255 - i) as u8, (i * 7) as u8])
                .collect();
            let mut enc = gif::Encoder::new(&mut out, w, h, &palette).expect("encoder");
            for k in 0..frames {
                let mut f = gif::Frame {
                    width: w,
                    height: h,
                    delay: cs,
                    ..Default::default()
                };
                f.buffer = std::borrow::Cow::Owned(vec![k as u8; usize::from(w) * usize::from(h)]);
                enc.write_frame(&f).expect("frame");
            }
        }
        out
    }

    #[test]
    fn delays_come_from_the_blocks_and_short_ones_show_for_100_ms() {
        let a = probe(&gif(4, 3, 5, 7)).expect("an animation");
        assert_eq!((a.format, a.size, a.frames()), (Format::Gif, [4, 3], 5));
        assert_eq!(a.delay(0), FLICKS * 7 / 100);
        let fast = probe(&gif(4, 3, 3, 1)).expect("an animation");
        assert_eq!(fast.delay(1), FLICKS / 10);
        assert_eq!(probe(&gif(4, 3, 1, 7)), None);
    }

    #[test]
    fn the_frame_at_a_time_comes_from_the_delays() {
        let a = probe(&gif(2, 2, 4, 10)).expect("an animation");
        let tenth = FLICKS / 10;
        assert_eq!(a.frame_at(0, false, false), 0);
        assert_eq!(a.frame_at(tenth - 1, false, false), 0);
        assert_eq!(a.frame_at(tenth, false, false), 1);
        assert_eq!(a.frame_at(4 * tenth + 5, true, false), 0);
        assert_eq!(a.frame_at(9 * tenth, false, false), 3);
        assert_eq!(a.frame_at(9 * tenth, false, true), 0);
        assert_eq!(a.next_change(tenth / 2, false, false), Some(tenth));
        assert_eq!(a.next_change(3 * tenth + 1, false, false), None);
        assert_eq!(a.next_change(7 * tenth + 1, true, false), Some(8 * tenth));
    }

    #[test]
    fn a_seek_shows_what_playing_shows_and_holds_its_canvas() {
        let bytes: Arc<[u8]> = Arc::from(gif(8, 8, 6, 10));
        let mut played = Player::open(bytes.clone(), false).unwrap().unwrap();
        let mut pictures = Vec::new();
        for k in 0..6 {
            pictures.push(played.frame(k).unwrap().to_vec());
            played.ahead(true).unwrap();
            assert_eq!(played.held(), 8 * 8 * 4);
        }
        let mut sought = Player::open(bytes, false).unwrap().unwrap();
        for k in [4, 1, 5, 0, 3] {
            assert_eq!(sought.frame(k).unwrap(), &pictures[k][..], "frame {k}");
        }
        assert_eq!(&pictures[2][..4], &[2, 253, 14, 255]);
    }

    #[test]
    fn an_apng_holds_its_canvas_between_frames_not_its_decode_buffer() {
        let mut bytes = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut bytes, 8, 8);
            enc.set_color(png::ColorType::Rgba);
            enc.set_animated(3, 0).unwrap();
            enc.set_frame_delay(1, 10).unwrap();
            let mut writer = enc.write_header().unwrap();
            for k in 0..3u8 {
                writer
                    .write_image_data(&[k * 80, 9, 9, 255].repeat(64))
                    .unwrap();
            }
            writer.finish().unwrap();
        }
        let mut player = Player::open(Arc::from(bytes), false).unwrap().unwrap();
        for k in 0..3 {
            assert_eq!(&player.frame(k).unwrap()[..4], &[k as u8 * 80, 9, 9, 255]);
            player.ahead(true).unwrap();
            assert_eq!(player.held(), 8 * 8 * 4, "frame {k}");
        }
    }

    #[test]
    fn the_planted_player_keeps_every_frame() {
        let bytes: Arc<[u8]> = Arc::from(gif(8, 8, 6, 10));
        let mut every = Player::open(bytes, true).unwrap().unwrap();
        for k in 0..6 {
            every.frame(k).unwrap();
        }
        assert!(every.held() >= 6 * 8 * 8 * 4);
    }
}
