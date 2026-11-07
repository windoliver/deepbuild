//! The bundled fonts: the only fonts the canvas's text ever uses, on every platform. Each role
//! names one family; the shaper picks the face by weight. Issue #417 adds the faces a look names
//! beside Inter and JetBrains Mono: a math face (STIX Two Math), a handwriting face (Caveat) and the
//! fallback faces for Han (Noto Sans SC), Arabic (Noto Sans Arabic) and emoji (Noto Emoji). Every
//! face ships under the SIL Open Font License, its text beside it (fonts/LICENSE-*.txt), and its
//! own embedding bits allow embedding (Look `look@1`: `fonts`).

use std::sync::Arc;

use parley::fontique::Blob;

/// A font role of the look (canvas primitives: Look `look@1`, `roles`). `body` is Text's default.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Role {
    /// Inter: labels, readouts and copy.
    Body,
    /// JetBrains Mono: code and anything that lines up by column.
    Mono,
    /// STIX Two Math: a lone symbol beside typeset formulas (#417).
    Math,
}

impl Role {
    /// The role's name in a document (`font: body | mono`).
    pub fn name(self) -> &'static str {
        match self {
            Role::Body => "body",
            Role::Mono => "mono",
            Role::Math => "math",
        }
    }

    /// The role by its document name.
    pub fn parse(name: &str) -> Option<Role> {
        match name {
            "body" => Some(Role::Body),
            "mono" => Some(Role::Mono),
            "math" => Some(Role::Math),
            _ => None,
        }
    }

    /// The family name the bundled face registers under.
    pub fn family(self) -> &'static str {
        match self {
            Role::Body => "Inter",
            Role::Mono => "JetBrains Mono",
            Role::Math => "STIX Two Math",
        }
    }
}

/// One bundled face: its family, its weight, its file name under `fonts/`, its license (an SPDX
/// ID) with the file under `fonts/` that holds its text, and its bytes.
pub struct Face {
    pub family: &'static str,
    pub weight: u16,
    pub file: &'static str,
    pub license: &'static str,
    pub license_file: &'static str,
    pub bytes: &'static [u8],
}

/// Every bundled face, in the order they register: one static, so a face's bytes have one
/// address wherever they are read.
pub static FACES: &[Face] = &[
    Face {
        family: "Inter",
        weight: 400,
        file: "Inter-Regular.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-Inter.txt",
        bytes: include_bytes!("../fonts/Inter-Regular.ttf"),
    },
    Face {
        family: "Inter",
        weight: 500,
        file: "Inter-Medium.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-Inter.txt",
        bytes: include_bytes!("../fonts/Inter-Medium.ttf"),
    },
    Face {
        family: "Inter",
        weight: 600,
        file: "Inter-SemiBold.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-Inter.txt",
        bytes: include_bytes!("../fonts/Inter-SemiBold.ttf"),
    },
    // #496: the variable face, a weight axis from 100 to 900, for text whose weight a channel
    // drives; every weight it takes is shaped from these bytes, never snapped to a static face.
    Face {
        family: "Inter Variable",
        weight: 400,
        file: "InterVariable.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-Inter.txt",
        bytes: include_bytes!("../fonts/InterVariable.ttf"),
    },
    Face {
        family: "JetBrains Mono",
        weight: 400,
        file: "JetBrainsMono-Regular.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-JetBrainsMono.txt",
        bytes: include_bytes!("../fonts/JetBrainsMono-Regular.ttf"),
    },
    Face {
        family: "JetBrains Mono",
        weight: 500,
        file: "JetBrainsMono-Medium.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-JetBrainsMono.txt",
        bytes: include_bytes!("../fonts/JetBrainsMono-Medium.ttf"),
    },
    Face {
        family: "STIX Two Math",
        weight: 400,
        file: "STIXTwoMath-Regular.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-STIXTwoMath.txt",
        bytes: include_bytes!("../fonts/STIXTwoMath-Regular.ttf"),
    },
    Face {
        family: "Caveat",
        weight: 400,
        file: "Caveat-Regular.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-Caveat.txt",
        bytes: include_bytes!("../fonts/Caveat-Regular.ttf"),
    },
    Face {
        family: "Noto Sans SC",
        weight: 400,
        file: "NotoSansSC-Regular.otf",
        license: "OFL-1.1",
        license_file: "LICENSE-NotoSansSC.txt",
        bytes: include_bytes!("../fonts/NotoSansSC-Regular.otf"),
    },
    Face {
        family: "Noto Sans Arabic",
        weight: 400,
        file: "NotoSansArabic-Regular.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-NotoSansArabic.txt",
        bytes: include_bytes!("../fonts/NotoSansArabic-Regular.ttf"),
    },
    Face {
        family: "Noto Emoji",
        weight: 400,
        file: "NotoEmoji-Regular.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-NotoEmoji.txt",
        bytes: include_bytes!("../fonts/NotoEmoji-Regular.ttf"),
    },
];

/// #496: the family a text at `weight` is set in: `family` itself when it has a face at that
/// weight or no variable twin, else its variable twin, so a weight between or past the static
/// faces is drawn at that weight on the variable face's axis, never snapped to the nearest static.
pub fn family_at(family: &'static str, weight: u16) -> &'static str {
    let twin = match family {
        "Inter" => "Inter Variable",
        _ => return family,
    };
    if FACES
        .iter()
        .any(|f| f.family == family && f.weight == weight)
    {
        family
    } else {
        twin
    }
}

/// The static family a variable twin stands in for (#496's planted snapping build).
pub fn static_of(family: &'static str) -> &'static str {
    match family {
        "Inter Variable" => "Inter",
        _ => family,
    }
}

/// A face's bytes as the blob the font collection and the rasterizer share.
pub fn blob(face: &Face) -> Blob<u8> {
    Blob::new(Arc::new(face.bytes))
}

/// The bundled face a shaped glyph's font is, by its bytes.
pub fn face_of(font: &parley::FontData) -> Option<&'static Face> {
    let data = font.data.data();
    // By address first: a run's glyphs are read every frame, and comparing a face's bytes costs
    // a pass over the whole file. Then by value, for bytes that came from elsewhere.
    FACES
        .iter()
        .find(|f| std::ptr::eq(f.bytes, data))
        .or_else(|| {
            FACES
                .iter()
                .find(|f| f.bytes.len() == data.len() && f.bytes == data)
        })
}
