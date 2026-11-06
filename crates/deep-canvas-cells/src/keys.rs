//! Issue #990: the bytes a key sends its program, from the program's modes (technical design:
//! Stream and raw input). With no keyboard flags pushed, xterm's encoding: application-cursor
//! arrows as SS3, modifiers as `CSI 1 ; m X` and `CSI n ; m ~`, and a modified Enter, Tab or
//! Backspace as xterm's modifyOtherKeys `CSI 27 ; m ; code ~` (Shift+Tab is `CSI Z`, Option alone
//! is ESC before the key's byte), so Shift, Option and Control always reach the program. With
//! flags pushed, the progressive keyboard protocol: flag 1 disambiguates (`CSI code ; m u`), flag
//! 2 reports releases (`CSI code ; m:3 u`), flag 8 reports every key as an escape. Control matches a key by its physical position (its `code`),
//! whatever character the input source gives it.

/// The modifiers held with a key.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Mods {
    pub shift: bool,
    pub alt: bool,
    pub ctrl: bool,
}

impl Mods {
    /// The modifier parameter both encodings use: 1 + Shift 1 + Option 2 + Control 4.
    fn param(self) -> u8 {
        1 + u8::from(self.shift) + 2 * u8::from(self.alt) + 4 * u8::from(self.ctrl)
    }
}

const DISAMBIGUATE: u8 = 1;
const EVENT_TYPES: u8 = 2;
const ALL_AS_ESCAPES: u8 = 8;
const TEXT: u8 = 16;

/// The bytes of `key` (a name such as `enter`, `up` or `f5`, or a character) pressed with
/// `mods`, where `code` is its physical key (W3C UI Events), in the given modes.
pub fn encode(key: &str, code: Option<&str>, mods: Mods, app_cursor: bool, flags: u8) -> Vec<u8> {
    let m = mods.param();
    let csi = |s: String| format!("\x1b[{s}").into_bytes();
    let with_m = |n: &str, end: char| match m {
        1 => csi(format!("{n}{end}")),
        _ => csi(format!("{n};{m}{end}")),
    };
    // Enter, Tab, Backspace and Escape: their byte, and their code point for the escapes.
    let control = match key {
        "enter" | "return" => Some((b'\r', 13)),
        "tab" => Some((b'\t', 9)),
        "backspace" => Some((0x7f, 127)),
        "escape" => Some((0x1b, 27)),
        _ => None,
    };
    if let Some((byte, cp)) = control {
        let escape =
            flags & ALL_AS_ESCAPES != 0 || (flags & DISAMBIGUATE != 0 && (m != 1 || cp == 27));
        return match (flags, m) {
            _ if escape => with_m(&cp.to_string(), 'u'),
            (_, 1) => vec![byte],
            (0, 2) if cp == 9 => csi("Z".into()),
            (0, 3) => vec![0x1b, byte],
            _ => csi(format!("27;{m};{cp}~")),
        };
    }
    let letter = |l: char| match m {
        1 if app_cursor && flags == 0 => format!("\x1bO{l}").into_bytes(),
        1 => csi(l.to_string()),
        _ => csi(format!("1;{m}{l}")),
    };
    match key {
        "up" => return letter('A'),
        "down" => return letter('B'),
        "right" => return letter('C'),
        "left" => return letter('D'),
        "home" => return letter('H'),
        "end" => return letter('F'),
        _ => {}
    }
    if let Some(n) = key.strip_prefix('f').and_then(|n| n.parse::<u8>().ok()) {
        return match n {
            1..=4 => {
                let l = char::from(b'O' + n);
                match (flags, m, n) {
                    (0, 1, _) => format!("\x1bO{l}").into_bytes(),
                    (f, _, 3) if f != 0 => with_m("13", '~'),
                    _ => letter(l),
                }
            }
            5..=12 => {
                let num = [15, 17, 18, 19, 20, 21, 23, 24][usize::from(n - 5)];
                with_m(&num.to_string(), '~')
            }
            _ => Vec::new(),
        };
    }
    match key {
        "insert" => return with_m("2", '~'),
        "delete" => return with_m("3", '~'),
        "pageup" => return with_m("5", '~'),
        "pagedown" => return with_m("6", '~'),
        _ => {}
    }
    text_key(key, code, mods, flags)
}

/// The bytes of a key's release: none unless the program pushed flag 2, and then the press's
/// escape with event type 3. Enter, Tab and Backspace report a release only with flag 8.
pub fn release(key: &str, code: Option<&str>, mods: Mods, flags: u8) -> Vec<u8> {
    let plain = matches!(key, "enter" | "return" | "tab" | "backspace");
    if flags & EVENT_TYPES == 0 || (plain && flags & ALL_AS_ESCAPES == 0) {
        return Vec::new();
    }
    // A release is always an escape, with no text of its own.
    let press = encode(key, code, mods, false, (flags | ALL_AS_ESCAPES) & !TEXT);
    let Some(body) = press.strip_prefix(b"\x1b[".as_slice()) else {
        return Vec::new();
    };
    let Some((&end, params)) = body.split_last() else {
        return Vec::new();
    };
    let params = String::from_utf8_lossy(params);
    let mut fields: Vec<String> = params.split(';').map(str::to_string).collect();
    if fields[0].is_empty() {
        fields[0] = "1".into();
    }
    match fields.get_mut(1) {
        Some(m) if !m.is_empty() => m.push_str(":3"),
        Some(m) => *m = "1:3".into(),
        None => fields.push("1:3".into()),
    }
    let mut out = format!("\x1b[{}", fields.join(";")).into_bytes();
    out.push(end);
    out
}

/// A key that makes text. With Control or Option, the key is the one at its physical position.
fn text_key(key: &str, code: Option<&str>, mods: Mods, flags: u8) -> Vec<u8> {
    let physical = code
        .and_then(|c| c.strip_prefix("Key").or_else(|| c.strip_prefix("Digit")))
        .filter(|c| c.len() == 1)
        .and_then(|c| c.chars().next())
        .map(|c| c.to_ascii_lowercase());
    let base = match (mods.ctrl || mods.alt, physical) {
        (true, Some(p)) => p,
        _ => key.chars().next().unwrap_or('\0'),
    };
    let escape =
        flags & ALL_AS_ESCAPES != 0 || (flags & DISAMBIGUATE != 0 && (mods.ctrl || mods.alt));
    if escape && !key.is_empty() {
        let m = mods.param();
        let cp = u32::from(base.to_ascii_lowercase());
        let text: Vec<String> = key.chars().map(|c| u32::from(c).to_string()).collect();
        return match (m, flags & TEXT != 0 && !mods.ctrl && !mods.alt) {
            (1, false) => format!("\x1b[{cp}u"),
            (1, true) => format!("\x1b[{cp};;{}u", text.join(":")),
            (m, false) => format!("\x1b[{cp};{m}u"),
            (m, true) => format!("\x1b[{cp};{m};{}u", text.join(":")),
        }
        .into_bytes();
    }
    let mut out = Vec::new();
    if mods.alt {
        out.push(0x1b);
    }
    match (mods.ctrl, base) {
        (true, c @ ('a'..='z' | '@'..='_')) => out.push(c.to_ascii_uppercase() as u8 & 0x1f),
        (true, ' ' | '2') => out.push(0),
        (true, '/') => out.push(0x1f),
        _ => out.extend_from_slice(key.as_bytes()),
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHIFT: Mods = Mods {
        shift: true,
        alt: false,
        ctrl: false,
    };
    const CTRL: Mods = Mods {
        shift: false,
        alt: false,
        ctrl: true,
    };

    #[test]
    fn shift_enter_reaches_the_program_in_every_mode() {
        assert_eq!(encode("enter", None, Mods::default(), false, 0), b"\r");
        assert_eq!(encode("enter", None, SHIFT, false, 0), b"\x1b[27;2;13~");
        assert_eq!(encode("enter", None, SHIFT, false, 1), b"\x1b[13;2u");
        assert_eq!(
            encode("enter", None, Mods::default(), false, 31),
            b"\x1b[13u"
        );
    }

    #[test]
    fn arrows_follow_application_cursor_only_unmodified() {
        assert_eq!(encode("up", None, Mods::default(), true, 0), b"\x1bOA");
        assert_eq!(encode("up", None, CTRL, true, 0), b"\x1b[1;5A");
        assert_eq!(encode("up", None, Mods::default(), true, 1), b"\x1b[A");
    }

    #[test]
    fn a_release_is_reported_only_with_event_types() {
        assert_eq!(release("up", None, Mods::default(), 1), b"");
        assert_eq!(release("up", None, Mods::default(), 3), b"\x1b[1;1:3A");
        assert_eq!(release("up", None, CTRL, 3), b"\x1b[1;5:3A");
        assert_eq!(
            release("a", Some("KeyA"), Mods::default(), 3),
            b"\x1b[97;1:3u"
        );
        assert_eq!(release("enter", None, Mods::default(), 3), b"");
        assert_eq!(release("enter", None, SHIFT, 31), b"\x1b[13;2:3u");
        assert_eq!(release("f5", None, Mods::default(), 3), b"\x1b[15;1:3~");
    }

    #[test]
    fn control_matches_the_physical_key_under_any_layout() {
        assert_eq!(encode("с", Some("KeyC"), CTRL, false, 0), b"\x03");
        assert_eq!(encode("в", Some("KeyD"), CTRL, false, 0), b"\x04");
        assert_eq!(encode("с", Some("KeyC"), CTRL, false, 1), b"\x1b[99;5u");
    }
}
