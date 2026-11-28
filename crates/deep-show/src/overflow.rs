pub const OVERFLOW: &str = "\u{0}overflow:";

pub(super) fn tame_overflow(line: &str) -> Option<String> {
    let bytes = line.as_bytes();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    let mut changed = false;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b'"' {
            let start = i;
            i += 1;
            while i < bytes.len() && bytes[i] != b'"' {
                i += if bytes[i] == b'\\' { 2 } else { 1 };
            }
            i = (i + 1).min(bytes.len());
            out.push_str(&line[start..i]);
            continue;
        }
        if c == b'-' || c.is_ascii_digit() {
            let start = i;
            i += 1;
            while i < bytes.len()
                && matches!(bytes[i], b'0'..=b'9' | b'.' | b'e' | b'E' | b'+' | b'-')
            {
                i += 1;
            }
            let token = &line[start..i];
            match token.parse::<f64>() {
                Ok(n) if n.is_infinite() => {
                    out.push_str(&format!(
                        "\"{}{token}\"",
                        OVERFLOW.replace('\u{0}', "\\u0000")
                    ));
                    changed = true;
                }
                _ => out.push_str(token),
            }
            continue;
        }
        out.push(c as char);
        i += 1;
    }
    changed.then_some(out)
}
