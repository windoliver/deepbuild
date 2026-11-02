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
