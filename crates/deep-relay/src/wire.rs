//! relay@1's wire (packages/contracts/slots/relay@1.json): its committed digest, the relay's
//! limits, match IDs and the frame in its documented little-endian layout.

/// The protocol a relay's hello must name.
pub const PROTOCOL: &str = "relay@1";
/// A frame's header: match 16 B, player u8, confirmed u32, first u32, count u16.
pub const HEADER: usize = 27;
/// The shipped relay's limits per connection (canvas primitives: Net: relay protocol relay@1).
pub const FRAMES_PER_S: u64 = 240;
pub const FRAME_BYTES: u64 = 65_536;

pub type MatchId = [u8; 16];

/// relay@1's digest as committed in packages/contracts/digests.json.
pub fn digest() -> String {
    let digests: serde_json::Value =
        serde_json::from_str(include_str!("../../../packages/contracts/digests.json"))
            .unwrap_or_default();
    digests[PROTOCOL].as_str().unwrap_or_default().to_string()
}

/// Bytes as lowercase hex.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A match ID from its 32 lowercase hex digits.
pub fn match_id(text: &str) -> Option<MatchId> {
    if text.len() != 32 || !text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return None;
    }
    let mut id = [0; 16];
    for (i, byte) in id.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(id)
}

/// One frame: a copy's steps from `first`, each step's entries opaque to the relay.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frame {
    pub game: MatchId,
    pub player: u8,
    /// The lowest step this copy holds every player's entries for.
    pub confirmed: u32,
    pub first: u32,
    pub steps: Vec<Vec<u8>>,
}

impl Frame {
    pub fn encode(&self) -> Vec<u8> {
        let mut out =
            Vec::with_capacity(HEADER + self.steps.iter().map(|s| 2 + s.len()).sum::<usize>());
        out.extend_from_slice(&self.game);
        out.push(self.player);
        out.extend_from_slice(&self.confirmed.to_le_bytes());
        out.extend_from_slice(&self.first.to_le_bytes());
        out.extend_from_slice(&(self.steps.len() as u16).to_le_bytes());
        for step in &self.steps {
            out.extend_from_slice(&(step.len() as u16).to_le_bytes());
            out.extend_from_slice(step);
        }
        out
    }

    /// Reads a frame, naming the field that doesn't fit.
    pub fn decode(bytes: &[u8]) -> Result<Frame, String> {
        if bytes.len() < HEADER {
            return Err(format!(
                "{} bytes, short of the {HEADER}-byte header",
                bytes.len()
            ));
        }
        let u32_at =
            |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap_or_default());
        let count = u16::from_le_bytes([bytes[25], bytes[26]]);
        let mut steps = Vec::with_capacity(count as usize);
        let mut at = HEADER;
        for step in 0..count {
            let Some(len) = bytes.get(at..at + 2) else {
                return Err(format!(
                    "count {count}, yet the frame ends before step {step}'s bytes"
                ));
            };
            let len = u16::from_le_bytes([len[0], len[1]]) as usize;
            let Some(entries) = bytes.get(at + 2..at + 2 + len) else {
                return Err(format!(
                    "step {step}'s bytes {len} run past the frame's end"
                ));
            };
            steps.push(entries.to_vec());
            at += 2 + len;
        }
        if at != bytes.len() {
            return Err(format!(
                "count {count}, yet {} bytes follow its steps",
                bytes.len() - at
            ));
        }
        Ok(Frame {
            game: bytes[..16].try_into().unwrap_or_default(),
            player: bytes[16],
            confirmed: u32_at(17),
            first: u32_at(21),
            steps,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_reads_back_field_by_field() {
        let f = Frame {
            game: [7; 16],
            player: 3,
            confirmed: 0x0102_0304,
            first: 0x0a0b_0c0d,
            steps: vec![vec![1, 2], vec![]],
        };
        let bytes = f.encode();
        assert_eq!(&bytes[17..21], &[4, 3, 2, 1]);
        assert_eq!(&bytes[21..25], &[0x0d, 0x0c, 0x0b, 0x0a]);
        assert_eq!(&bytes[25..27], &[2, 0]);
        assert_eq!(Frame::decode(&bytes), Ok(f));
        assert!(Frame::decode(&bytes[..bytes.len() - 1]).is_err());
    }

    #[test]
    fn the_digest_is_the_committed_one() {
        assert!(
            digest().starts_with("d1:") && digest().len() == 67,
            "{}",
            digest()
        );
        assert_eq!(match_id(&hex(&[0xab; 16])), Some([0xab; 16]));
        assert_eq!(match_id("AB"), None);
    }
}
