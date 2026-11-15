//! Our own WAVE reader: PCM 8, 16, 24 and 32-bit and IEEE float, interleaved, to f32. Integer
//! samples become f32 as sample ÷ 2^(depth − 1) (canvas primitives: Decode worker).

pub struct Wav {
    pub rate: u32,
    pub channels: u16,
    pub bits: u16,
    pub float: bool,
    /// Frames (samples per channel).
    pub frames: u64,
    data: (usize, usize),
}

/// #503: a WAVE format tag as ffprobe names its codec, for a stream the worker refuses.
pub fn tag_name(tag: u16) -> String {
    match tag {
        0x0002 => "adpcm_ms".into(),
        0x0006 => "pcm_alaw".into(),
        0x0007 => "pcm_mulaw".into(),
        0x0011 => "adpcm_ima_wav".into(),
        0x0031 => "gsm_ms".into(),
        0x0050 => "mp2".into(),
        0x0055 => "mp3".into(),
        0x0160 => "wmav1".into(),
        0x0161 => "wmav2".into(),
        0x0162 => "wmapro".into(),
        0x0163 => "wmalossless".into(),
        0x2000 => "ac3".into(),
        0x2001 => "dts".into(),
        t => format!("wav tag {t:#06x}"),
    }
}

/// #503: the format tag of a WAVE file's `fmt ` chunk.
pub fn tag(b: &[u8]) -> Option<u16> {
    let mut at = 12;
    while let Some(size) = b.get(at + 4..at + 8) {
        let size = u32::from_le_bytes(size.try_into().ok()?) as usize;
        if b.get(at..at + 4) == Some(b"fmt ") {
            let tag = u16::from_le_bytes(b.get(at + 8..at + 10)?.try_into().ok()?);
            return match tag {
                0xfffe => Some(u16::from_le_bytes(
                    b.get(at + 32..at + 34)?.try_into().ok()?,
                )),
                t => Some(t),
            };
        }
        at = at.checked_add(8 + size + size % 2)?;
    }
    None
}

pub fn parse(b: &[u8]) -> Option<Wav> {
    let le16 = |o: usize| Some(u16::from_le_bytes([*b.get(o)?, *b.get(o + 1)?]));
    let le32 = |o: usize| Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?));
    let mut fmt = None;
    let mut data = None;
    let mut at = 12;
    while at + 8 <= b.len() {
        let size = le32(at + 4)? as usize;
        let body = at + 8;
        match &b[at..at + 4] {
            b"fmt " => {
                let mut tag = le16(body)?;
                if tag == 0xfffe {
                    tag = le16(body + 24)?;
                }
                fmt = Some((tag, le16(body + 2)?, le32(body + 4)?, le16(body + 14)?));
            }
            b"data" => data = Some((body, size.min(b.len() - body))),
            _ => {}
        }
        at = body + size + size % 2;
    }
    let (tag, channels, rate, bits) = fmt?;
    let float = match (tag, bits) {
        (1, 8 | 16 | 24 | 32) => false,
        (3, 32) => true,
        _ => return None,
    };
    let data = data?;
    let width = (bits / 8) as usize * channels.max(1) as usize;
    Some(Wav {
        rate,
        channels,
        bits,
        float,
        frames: (data.1 / width) as u64,
        data,
    })
}

impl Wav {
    pub fn codec(&self) -> String {
        match (self.float, self.bits) {
            (true, _) => "pcm_f32le".into(),
            (false, 8) => "pcm_u8".into(),
            (false, b) => format!("pcm_s{b}le"),
        }
    }

    /// Every sample as f32, interleaved.
    pub fn f32(&self, b: &[u8]) -> Vec<f32> {
        let bytes = &b[self.data.0..self.data.0 + self.data.1];
        let w = (self.bits / 8) as usize;
        let n = self.frames as usize * self.channels as usize;
        (0..n)
            .map(|i| {
                let s = &bytes[i * w..i * w + w];
                match (self.float, self.bits) {
                    (true, _) => f32::from_le_bytes([s[0], s[1], s[2], s[3]]),
                    (false, 8) => (s[0] as f32 - 128.0) / 128.0,
                    (false, 16) => i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0,
                    (false, 24) => {
                        (i32::from_le_bytes([0, s[0], s[1], s[2]]) >> 8) as f32 / 8_388_608.0
                    }
                    _ => i32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f32 / 2_147_483_648.0,
                }
            })
            .collect()
    }
}
