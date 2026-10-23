//! Standard base64, as mark set columns and sidecars carry bytes in a document.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// `bytes` as padded base64.
pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let acc = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for k in 0..4 {
            if k <= chunk.len() {
                out.push(ALPHABET[(acc >> (18 - 6 * k)) as usize & 63] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// The bytes of base64 `text`, padded or not; `None` for a character outside the alphabet or a
/// group of one character.
pub fn decode(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => u32::from(c - b'A'),
            b'a'..=b'z' => u32::from(c - b'a') + 26,
            b'0'..=b'9' => u32::from(c - b'0') + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        })
    };
    let body = text.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(body.len() * 3 / 4);
    for chunk in body.chunks(4) {
        let mut acc = 0u32;
        for (k, &c) in chunk.iter().enumerate() {
            acc |= value(c)? << (18 - 6 * k as u32);
        }
        let b = acc.to_be_bytes();
        match chunk.len() {
            4 => out.extend(&b[1..4]),
            3 => out.extend(&b[1..3]),
            2 => out.push(b[1]),
            _ => return None,
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        for bytes in [
            vec![],
            vec![1],
            vec![1, 2],
            vec![1, 2, 3],
            vec![255, 0, 7, 9],
        ] {
            assert_eq!(decode(&encode(&bytes)).unwrap(), bytes);
        }
    }

    #[test]
    fn reads_padded_and_unpadded_groups() {
        assert_eq!(decode("AAECAw==").unwrap(), vec![0, 1, 2, 3]);
        assert_eq!(decode("AAEC").unwrap(), vec![0, 1, 2]);
        assert!(decode("A$").is_none());
    }
}
