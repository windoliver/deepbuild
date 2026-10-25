//! The bundled fonts: the only fonts the canvas's text ever uses, on every platform. Each role
//! names one family; the shaper picks the face by weight. Both families ship under the SIL Open
//! Font License (fonts/LICENSE-Inter.txt, fonts/LICENSE-JetBrainsMono.txt).

use std::sync::Arc;

use parley::fontique::Blob;

/// A font role of the look (canvas primitives: Look `look@1`, `roles`). `body` is Text's default.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Role {
    /// Inter: labels, readouts and copy.
    Body,
    /// JetBrains Mono: code and anything that lines up by column.
    Mono,
}

impl Role {
    /// The role's name in a document (`font: body | mono`).
    pub fn name(self) -> &'static str {
        match self {
            Role::Body => "body",
            Role::Mono => "mono",
        }
    }

    /// The role by its document name.
    pub fn parse(name: &str) -> Option<Role> {
        match name {
            "body" => Some(Role::Body),
            "mono" => Some(Role::Mono),
            _ => None,
        }
    }

    /// The family name the bundled face registers under.
    pub fn family(self) -> &'static str {
        match self {
            Role::Body => "Inter",
            Role::Mono => "JetBrains Mono",
        }
    }
}

/// One bundled face: its family's role, its weight, its file name under `fonts/` and its bytes.
pub struct Face {
    pub role: Role,
    pub weight: u16,
    pub file: &'static str,
    pub bytes: &'static [u8],
}

/// Every bundled face, in the order they register.
pub const FACES: &[Face] = &[
    Face {
        role: Role::Body,
        weight: 400,
        file: "Inter-Regular.ttf",
        bytes: include_bytes!("../fonts/Inter-Regular.ttf"),
    },
    Face {
        role: Role::Body,
        weight: 500,
        file: "Inter-Medium.ttf",
        bytes: include_bytes!("../fonts/Inter-Medium.ttf"),
    },
    Face {
        role: Role::Body,
        weight: 600,
        file: "Inter-SemiBold.ttf",
        bytes: include_bytes!("../fonts/Inter-SemiBold.ttf"),
    },
    Face {
        role: Role::Mono,
        weight: 400,
        file: "JetBrainsMono-Regular.ttf",
        bytes: include_bytes!("../fonts/JetBrainsMono-Regular.ttf"),
    },
    Face {
        role: Role::Mono,
        weight: 500,
        file: "JetBrainsMono-Medium.ttf",
        bytes: include_bytes!("../fonts/JetBrainsMono-Medium.ttf"),
    },
];

/// A face's bytes as the blob the font collection and the rasterizer share.
pub fn blob(face: &Face) -> Blob<u8> {
    Blob::new(Arc::new(face.bytes))
}

/// The bundled face a shaped glyph's font is, by its bytes.
pub fn face_of(font: &parley::FontData) -> Option<&'static Face> {
    let data = font.data.data();
    // By value: `FACES` is a const, so each use may hold its own copy of the bytes.
    FACES
        .iter()
        .find(|f| f.bytes.len() == data.len() && f.bytes == data)
}
