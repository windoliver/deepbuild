use super::*;

/// An animated PNG of `frames`, PNG files of one size and colour type, each shown for 1/`fps` s: the first frame's
/// header, then each frame's image data under its frame control, so nothing is compressed twice.
pub(super) fn animated_png(frames: &[PathBuf], fps: u16) -> Result<Vec<u8>, String> {
    /// A PNG's chunks, each its type and its data.
    type Chunks<'a> = Vec<(&'a [u8], &'a [u8])>;
    fn chunks(png: &[u8]) -> Result<Chunks<'_>, String> {
        let mut out = Vec::new();
        let mut at = 8;
        while at + 12 <= png.len() {
            let len = u32::from_be_bytes(png[at..at + 4].try_into().expect("4 bytes")) as usize;
            let end = at + 12 + len;
            if end > png.len() {
                return Err("a frame's PNG is cut short".into());
            }
            out.push((&png[at + 4..at + 8], &png[at + 8..at + 8 + len]));
            at = end;
        }
        Ok(out)
    }
    fn chunk(out: &mut Vec<u8>, kind: &[u8], data: &[u8]) {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let mut crc = crc32fast::Hasher::new();
        crc.update(kind);
        crc.update(data);
        out.extend_from_slice(kind);
        out.extend_from_slice(data);
        out.extend_from_slice(&crc.finalize().to_be_bytes());
    }
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut sequence = 0u32;
    for (index, path) in frames.iter().enumerate() {
        let png = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let parts = chunks(&png)?;
        let header = parts
            .iter()
            .find(|(kind, _)| *kind == b"IHDR")
            .ok_or("a frame has no header")?
            .1;
        if index == 0 {
            chunk(&mut out, b"IHDR", header);
            let mut control = (frames.len() as u32).to_be_bytes().to_vec();
            control.extend_from_slice(&0u32.to_be_bytes());
            chunk(&mut out, b"acTL", &control);
        }
        let mut control = sequence.to_be_bytes().to_vec();
        control.extend_from_slice(&header[..8]);
        control.extend_from_slice(&[0; 8]);
        control.extend_from_slice(&1u16.to_be_bytes());
        control.extend_from_slice(&fps.to_be_bytes());
        control.extend_from_slice(&[0, 0]);
        chunk(&mut out, b"fcTL", &control);
        sequence += 1;
        for (_, data) in parts.iter().filter(|(kind, _)| *kind == b"IDAT") {
            if index == 0 {
                chunk(&mut out, b"IDAT", data);
            } else {
                let mut frame = sequence.to_be_bytes().to_vec();
                frame.extend_from_slice(data);
                chunk(&mut out, b"fdAT", &frame);
                sequence += 1;
            }
        }
    }
    chunk(&mut out, b"IEND", &[]);
    Ok(out)
}
