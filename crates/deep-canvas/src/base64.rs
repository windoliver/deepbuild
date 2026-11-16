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
    // Each byte's value, or 64 outside the alphabet.
    const VALUE: [u8; 256] = {
        let mut t = [64u8; 256];
        let mut i = 0;
        while i < 64 {
            t[ALPHABET[i] as usize] = i as u8;
            i += 1;
        }
        t
    };
    // A group's bytes, as the low three of its 24 bits; `None` for a character outside the
    // alphabet.
    let group = |chunk: &[u8]| -> Option<[u8; 4]> {
        let mut acc = 0u32;
        let mut bad = 0u8;
        for (k, &c) in chunk.iter().enumerate() {
            let v = VALUE[usize::from(c)];
            bad |= v;
            acc |= u32::from(v) << (18 - 6 * k as u32);
        }
        (bad & 64 == 0).then(|| acc.to_be_bytes())
    };
    let body = text.trim_end_matches('=').as_bytes();
    let (whole, rest) = body.as_chunks::<4>();
    let tail = match rest.len() {
        0 => 0,
        1 => return None,
        n => n - 1,
    };
    let mut out = vec![0u8; whole.len() * 3 + tail];
    let (bytes, last) = out.as_chunks_mut::<3>();
    for (chunk, bytes) in whole.iter().zip(bytes) {
        let b = group(chunk)?;
        *bytes = [b[1], b[2], b[3]];
    }
    if tail > 0 {
        last.copy_from_slice(&group(rest)?[1..=tail]);
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
