//! Order keys (canvas primitives: Order keys): a fractional index, a base-62 string compared by
//! code point. A new key falls between its neighbors, with jitter seeded from (writer, patch ID),
//! so two writers inserting at one spot get distinct keys and a replay gives the same ones.

use sha2::{Digest, Sha256};

/// The base-62 digits in code-point order.
const DIGITS: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/// The jitter's length in digits: 62^4 keys between any two neighbors.
const JITTER: usize = 4;

fn digit(c: u8) -> Option<usize> {
    DIGITS.iter().position(|d| *d == c)
}

/// A key strictly between `lo` and `hi` (`None`: no neighbor on that side), whose last digits
/// are seeded by `seed`; `None` when no key fits (`hi` is `"0"`, or the neighbors are out of
/// order or not base-62).
pub fn key_between(lo: Option<&str>, hi: Option<&str>, seed: &[u8]) -> Option<String> {
    let lo = lo.unwrap_or("");
    let ok = |k: &str| k.bytes().all(|c| digit(c).is_some());
    if !ok(lo) || hi.is_some_and(|h| !ok(h) || h <= lo) {
        return None;
    }
    let digest = Sha256::digest(seed);
    // Never a trailing zero, so nothing is left between a key and itself with a 0 appended.
    let mut jitter: Vec<u8> = digest[..JITTER]
        .iter()
        .map(|b| DIGITS[*b as usize % 62])
        .collect();
    jitter[JITTER - 1] = DIGITS[1 + digest[JITTER] as usize % 61];
    let jitter = String::from_utf8(jitter).ok()?;
    let Some(hi) = hi else {
        // Anything that starts with `lo` and goes on sorts after it.
        return Some(format!("{lo}{jitter}"));
    };
    let (lo, hi) = (lo.as_bytes(), hi.as_bytes());
    let shared = lo.iter().zip(hi).take_while(|(a, b)| a == b).count();
    let prefix = std::str::from_utf8(&hi[..shared]).ok()?;
    if shared == lo.len() {
        // `lo` is a prefix of `hi`: a key below `hi`'s rest, after `lo`.
        return below(&hi[shared..], &jitter).map(|rest| format!("{prefix}{rest}"));
    }
    let (a, b) = (digit(lo[shared])?, digit(hi[shared])?);
    if b - a > 1 {
        let mid = DIGITS[(a + b) / 2] as char;
        return Some(format!("{prefix}{mid}{jitter}"));
    }
    // The next digits are neighbors: stay on `lo`'s and go on past it.
    let lo = std::str::from_utf8(lo).ok()?;
    Some(format!("{lo}{jitter}"))
}

/// A non-empty key below `hi`, which is non-empty.
fn below(hi: &[u8], jitter: &str) -> Option<String> {
    let first = digit(*hi.first()?)?;
    if first > 1 {
        return Some(format!("{}{jitter}", DIGITS[first / 2] as char));
    }
    if first == 1 {
        return Some(format!("0{jitter}"));
    }
    // A leading 0: keep it and go below the rest.
    below(&hi[1..], jitter).map(|rest| format!("0{rest}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_fall_between_their_neighbors() {
        let cases: [(Option<&str>, Option<&str>); 8] = [
            (Some("a0"), Some("a1")),
            (Some("a0"), Some("b")),
            (Some("a"), Some("a0V")),
            (Some("a0"), None),
            (None, Some("a0")),
            (None, Some("01")),
            (Some("Zz"), Some("a")),
            (None, None),
        ];
        for (n, (lo, hi)) in cases.into_iter().enumerate() {
            for seed in 0u8..20 {
                let k = key_between(lo, hi, &[n as u8, seed]).unwrap();
                assert!(lo.is_none_or(|l| l < k.as_str()), "{lo:?} < {k}");
                assert!(hi.is_none_or(|h| k.as_str() < h), "{k} < {hi:?}");
                assert!(!k.ends_with('0'), "{k}");
            }
        }
    }

    #[test]
    fn seeds_spread_and_replay() {
        let a = key_between(Some("a0"), Some("a1"), b"agent:a|01J");
        let b = key_between(Some("a0"), Some("a1"), b"agent:b|01J");
        assert_ne!(a, b);
        assert_eq!(a, key_between(Some("a0"), Some("a1"), b"agent:a|01J"));
    }

    #[test]
    fn no_key_fits_below_zero_or_between_disordered_neighbors() {
        assert_eq!(key_between(None, Some("0"), b"s"), None);
        assert_eq!(key_between(Some("b"), Some("a"), b"s"), None);
        assert_eq!(key_between(Some("a!"), None, b"s"), None);
    }
}
