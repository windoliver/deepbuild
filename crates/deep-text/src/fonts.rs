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
/// ID) with the file under `fonts/` that holds its text, and its bytes. In the web player (#172)
/// the faces travel as the bundle's own files, by hash, so the player's bytes hold none: each
/// face's bytes are those the page gives [`provide`] before the first text is set.
pub struct Face {
    pub family: &'static str,
    pub weight: u16,
    pub file: &'static str,
    pub license: &'static str,
    pub license_file: &'static str,
    #[cfg_attr(target_arch = "wasm32", allow(dead_code))]
    bytes: &'static [u8],
}

/// A face's bytes in this build: compiled in.
#[cfg(not(target_arch = "wasm32"))]
macro_rules! face_bytes {
    ($file:literal) => {
        include_bytes!(concat!("../fonts/", $file))
    };
}

/// In the web player, none compiled in: the bundle's file arrives through [`provide`].
#[cfg(target_arch = "wasm32")]
macro_rules! face_bytes {
    ($file:literal) => {
        &[]
    };
}

#[cfg(target_arch = "wasm32")]
static PROVIDED: std::sync::Mutex<Vec<(&'static str, &'static [u8])>> =
    std::sync::Mutex::new(Vec::new());

/// The web player's face `file`, as the bundle carries it, kept for the page's life; a name no
/// face has is ignored. Faces given twice keep the first bytes, so a face's bytes have one address.
#[cfg(target_arch = "wasm32")]
pub fn provide(file: &str, bytes: Vec<u8>) {
    let Some(face) = FACES.iter().find(|f| f.file == file) else {
        return;
    };
    let mut given = PROVIDED.lock().unwrap_or_else(|e| e.into_inner());
    if !given.iter().any(|(f, _)| *f == face.file) {
        given.push((face.file, Box::leak(bytes.into_boxed_slice())));
    }
}

/// Each bundled face's license file by name, with its text: what travels beside a face that
/// leaves the app, such as a web player's bundle (#172).
#[cfg(not(target_arch = "wasm32"))]
pub static LICENSES: &[(&str, &str)] = &[
    (
        "LICENSE-Caveat.txt",
        include_str!("../fonts/LICENSE-Caveat.txt"),
    ),
    (
        "LICENSE-Inter.txt",
        include_str!("../fonts/LICENSE-Inter.txt"),
    ),
    (
        "LICENSE-JetBrainsMono.txt",
        include_str!("../fonts/LICENSE-JetBrainsMono.txt"),
    ),
    (
        "LICENSE-NotoEmoji.txt",
        include_str!("../fonts/LICENSE-NotoEmoji.txt"),
    ),
    (
        "LICENSE-NotoSansArabic.txt",
        include_str!("../fonts/LICENSE-NotoSansArabic.txt"),
    ),
    (
        "LICENSE-NotoSansSC.txt",
        include_str!("../fonts/LICENSE-NotoSansSC.txt"),
    ),
    (
        "LICENSE-STIXTwoMath.txt",
        include_str!("../fonts/LICENSE-STIXTwoMath.txt"),
    ),
];

impl Face {
    /// The face's bytes: compiled in, or in the web player the bundle's file given to [`provide`]
    /// (none before it arrives).
    pub fn bytes(&self) -> &'static [u8] {
        #[cfg(target_arch = "wasm32")]
        {
            let given = PROVIDED.lock().unwrap_or_else(|e| e.into_inner());
            return given
                .iter()
                .find(|(f, _)| *f == self.file)
                .map_or(&[][..], |(_, b)| *b);
        }
        #[cfg(not(target_arch = "wasm32"))]
        self.bytes
    }
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
        bytes: face_bytes!("Inter-Regular.ttf"),
    },
    Face {
        family: "Inter",
        weight: 500,
        file: "Inter-Medium.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-Inter.txt",
        bytes: face_bytes!("Inter-Medium.ttf"),
    },
    Face {
        family: "Inter",
        weight: 600,
        file: "Inter-SemiBold.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-Inter.txt",
        bytes: face_bytes!("Inter-SemiBold.ttf"),
    },
    // #496: the variable face, a weight axis from 100 to 900, for text whose weight a channel
    // drives; every weight it takes is shaped from these bytes, never snapped to a static face.
    Face {
        family: "Inter Variable",
        weight: 400,
        file: "InterVariable.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-Inter.txt",
        bytes: face_bytes!("InterVariable.ttf"),
    },
    Face {
        family: "JetBrains Mono",
        weight: 400,
        file: "JetBrainsMono-Regular.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-JetBrainsMono.txt",
        bytes: face_bytes!("JetBrainsMono-Regular.ttf"),
    },
    Face {
        family: "JetBrains Mono",
        weight: 500,
        file: "JetBrainsMono-Medium.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-JetBrainsMono.txt",
        bytes: face_bytes!("JetBrainsMono-Medium.ttf"),
    },
    Face {
        family: "STIX Two Math",
        weight: 400,
        file: "STIXTwoMath-Regular.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-STIXTwoMath.txt",
        bytes: face_bytes!("STIXTwoMath-Regular.ttf"),
    },
    Face {
        family: "Caveat",
        weight: 400,
        file: "Caveat-Regular.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-Caveat.txt",
        bytes: face_bytes!("Caveat-Regular.ttf"),
    },
    Face {
        family: "Noto Sans SC",
        weight: 400,
        file: "NotoSansSC-Regular.otf",
        license: "OFL-1.1",
        license_file: "LICENSE-NotoSansSC.txt",
        bytes: face_bytes!("NotoSansSC-Regular.otf"),
    },
    Face {
        family: "Noto Sans Arabic",
        weight: 400,
        file: "NotoSansArabic-Regular.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-NotoSansArabic.txt",
        bytes: face_bytes!("NotoSansArabic-Regular.ttf"),
    },
    Face {
        family: "Noto Emoji",
        weight: 400,
        file: "NotoEmoji-Regular.ttf",
        license: "OFL-1.1",
        license_file: "LICENSE-NotoEmoji.txt",
        bytes: face_bytes!("NotoEmoji-Regular.ttf"),
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
    Blob::new(Arc::new(face.bytes()))
}

/// The bundled face a shaped glyph's font is, by its bytes.
pub fn face_of(font: &parley::FontData) -> Option<&'static Face> {
    let data = font.data.data();
    // By address first: a run's glyphs are read every frame, and comparing a face's bytes costs
    // a pass over the whole file. Then by value, for bytes that came from elsewhere.
    FACES
        .iter()
        .find(|f| std::ptr::eq(f.bytes(), data))
        .or_else(|| {
            FACES
                .iter()
                .find(|f| f.bytes().len() == data.len() && f.bytes() == data)
        })
}
