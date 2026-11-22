//! #2892: the form a web bundle stores a file in when its format doesn't compress its own data:
//! one gzip member with no name, no time and no comment, deflated by miniz_oxide 0.9 at level 9,
//! so a file's stored bytes are the same on every machine and in every build. The browser
//! inflates it with its own stream inflater. The build script compiles this file too, to store
//! the player's prebuilt module sets once per build.

/// `bytes` as the bundle stores them.
pub fn gzip(bytes: &[u8]) -> Vec<u8> {
    // ID, deflate, no flags, no time, the slowest deflate (XFL 2), an unknown system (255).
    let mut out = vec![0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 255];
    out.extend(miniz_oxide::deflate::compress_to_vec(bytes, 9));
    let mut crc = crc32fast::Hasher::new();
    crc.update(bytes);
    out.extend(crc.finalize().to_le_bytes());
    out.extend((bytes.len() as u32).to_le_bytes());
    out
}

/// The bytes a stored file inflates to, read no further than `size`: none when it isn't the one
/// member [`gzip`] writes, inflates past `size` or short of it, or fails its CRC.
#[allow(dead_code)] // the build script stores, and never reads back
pub fn gunzip(stored: &[u8], size: usize) -> Option<Vec<u8>> {
    let body = stored.get(10..stored.len().checked_sub(8)?)?;
    if stored.get(..4)? != [0x1f, 0x8b, 8, 0] {
        return None;
    }
    let bytes = miniz_oxide::inflate::decompress_to_vec_with_limit(body, size).ok()?;
    let trailer = &stored[stored.len() - 8..];
    let mut crc = crc32fast::Hasher::new();
    crc.update(&bytes);
    let whole = bytes.len() == size
        && trailer[..4] == crc.finalize().to_le_bytes()
        && trailer[4..] == (size as u32).to_le_bytes();
    whole.then_some(bytes)
}
