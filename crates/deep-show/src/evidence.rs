//! The evidence store's files by hash (`packages/evidence`: `<first 2 hex>/<other 62 hex>` under
//! its root), as render-back keeps a revision's issues and snapshots, and reads an image's asset.

use std::fs;
use std::path::{Path, PathBuf};

pub use deep_canvas::canon::sha256_hex;

fn file_of(root: &Path, sha: &str) -> PathBuf {
    root.join(&sha[..2]).join(&sha[2..])
}

/// Keeps `bytes` by their SHA-256, written whole before it is named: a temporary file renamed.
pub fn put(root: &Path, bytes: &[u8]) -> std::io::Result<String> {
    let sha = sha256_hex(bytes);
    let path = file_of(root, &sha);
    if path.exists() {
        return Ok(sha);
    }
    let dir = path.parent().expect("a hash's file has a folder");
    fs::create_dir_all(dir)?;
    let temp = dir.join(format!(".tmp-{}-{}", std::process::id(), &sha[..16]));
    fs::write(&temp, bytes)?;
    fs::rename(&temp, &path)?;
    Ok(sha)
}

/// The bytes kept under `sha`, if they are there and still match it.
pub fn read(root: &Path, sha: &str) -> Option<Vec<u8>> {
    let valid = sha.len() == 64 && sha.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if !valid {
        return None;
    }
    let bytes = fs::read(file_of(root, sha)).ok()?;
    (sha256_hex(&bytes) == sha).then_some(bytes)
}
