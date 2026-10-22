//! Content keys (canvas primitives: Content key): 128 bits of SHA-256 over length-prefixed fields,
//! computed from what a result reads and never from how the document got there. A float enters by
//! its bits, with −0 stored as +0.

use sha2::{Digest, Sha256};

/// A 128-bit content key.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ContentKey(pub [u8; 16]);

impl ContentKey {
    /// Lower-case hex, 32 digits.
    pub fn hex(&self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }
}

/// Builds a key from fields, each written with its length first, so no two field lists share a
/// byte stream.
pub struct KeyBuilder(Sha256);

impl KeyBuilder {
    /// A key for `operator`, the operator and its canvas module's version, such as
    /// `tessellate@marks2d.1`.
    pub fn new(operator: &str) -> KeyBuilder {
        let mut b = KeyBuilder(Sha256::new());
        b.text(operator);
        b
    }

    pub fn bytes(&mut self, bytes: &[u8]) -> &mut Self {
        self.0.update((bytes.len() as u64).to_le_bytes());
        self.0.update(bytes);
        self
    }

    pub fn text(&mut self, text: &str) -> &mut Self {
        self.bytes(text.as_bytes())
    }

    pub fn number(&mut self, n: f64) -> &mut Self {
        let n = if n == 0.0 { 0.0 } else { n };
        self.bytes(&n.to_bits().to_le_bytes())
    }

    pub fn int(&mut self, n: i64) -> &mut Self {
        self.bytes(&n.to_le_bytes())
    }

    pub fn key(&mut self, key: &ContentKey) -> &mut Self {
        self.bytes(&key.0)
    }

    pub fn finish(&self) -> ContentKey {
        let digest = self.0.clone().finalize();
        let mut out = [0u8; 16];
        out.copy_from_slice(&digest[..16]);
        ContentKey(out)
    }
}

/// Lower-case hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
