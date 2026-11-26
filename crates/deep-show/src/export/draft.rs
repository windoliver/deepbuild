//! Issue #231: a draft stays where it is made (Export: a draft "stays in the app's store, and it
//! can never be shared, attached or sent"). Before a draft takes its name, the evidence store is
//! told each of its files by the SHA-256 of its bytes, under `drafts/`, so a Send that names one
//! is refused, by this process or a later one on the same store.

use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::hub::Hub;

/// Where the store keeps the mark of a draft's file.
fn mark_of(evidence: &Path, sha: &str) -> PathBuf {
    evidence.join("drafts").join(sha)
}

/// Every file at or under `path`.
fn files_under(path: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    if !path.is_dir() {
        out.push(path.to_path_buf());
        return Ok(());
    }
    for entry in fs::read_dir(path)? {
        files_under(&entry?.path(), out)?;
    }
    Ok(())
}

/// The SHA-256 of each file at or under `path`.
fn hashes_under(path: &Path) -> std::io::Result<Vec<String>> {
    let mut files = Vec::new();
    files_under(path, &mut files)?;
    let mut out = Vec::with_capacity(files.len());
    for file in files {
        let (mut hash, mut read) = (Sha256::new(), vec![0u8; 1 << 16]);
        let mut bytes = fs::File::open(&file)?;
        loop {
            let n = bytes.read(&mut read)?;
            if n == 0 {
                break;
            }
            hash.update(&read[..n]);
        }
        out.push(super::hex(hash.finalize()));
    }
    Ok(out)
}

impl Hub<'_> {
    /// Marks the draft written at `path`, a file or a folder of files, in the evidence store.
    pub(super) fn mark_draft(&self, path: &Path) -> std::io::Result<()> {
        fs::create_dir_all(self.scenario.evidence.join("drafts"))?;
        for sha in hashes_under(path)? {
            fs::write(mark_of(&self.scenario.evidence, &sha), b"")?;
        }
        Ok(())
    }

    /// A delivery written at `path` is no draft, whatever was exported before it: a mark the
    /// store holds for the same bytes goes, since these bytes passed the delivery's checks. A
    /// store that holds no draft's mark is left unread.
    pub(super) fn clear_drafts(&self, path: &Path) -> std::io::Result<()> {
        if !self.scenario.evidence.join("drafts").is_dir() {
            return Ok(());
        }
        for sha in hashes_under(path)? {
            match fs::remove_file(mark_of(&self.scenario.evidence, &sha)) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
                _ => {}
            }
        }
        Ok(())
    }

    /// Whether the store marks the file `sha` a draft's.
    pub(crate) fn is_draft(&self, sha: &str) -> bool {
        mark_of(&self.scenario.evidence, sha).exists()
    }
}
