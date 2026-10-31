//! Canonical bytes for typed results (issue #855; canvas primitives: Content key). Every typed
//! value an operator writes encodes itself through [`Canonical`]: fields in declared order,
//! integers little-endian at their width, floats by their bits, strings as length-prefixed UTF-8
//! and lists by their length then each element. Debug formatting is never a digest's input, so a
//! compiler that prints a type another way changes no digest.

use std::collections::BTreeMap;
use std::sync::Arc;

/// A typed result's own encoding, the bytes its result digest reads.
pub trait Canonical {
    fn encode(&self, out: &mut Vec<u8>);

    /// The bytes [`Canonical::encode`] writes.
    fn canonical_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        self.encode(&mut out);
        out
    }
}

macro_rules! le {
    ($($t:ty),*) => {$(
        impl Canonical for $t {
            fn encode(&self, out: &mut Vec<u8>) {
                out.extend_from_slice(&self.to_le_bytes());
            }
        }
    )*};
}
le!(u8, u16, u32, u64, i32, i64);

impl Canonical for usize {
    fn encode(&self, out: &mut Vec<u8>) {
        (*self as u64).encode(out);
    }
}

impl Canonical for f32 {
    fn encode(&self, out: &mut Vec<u8>) {
        self.to_bits().encode(out);
    }
}

impl Canonical for f64 {
    fn encode(&self, out: &mut Vec<u8>) {
        self.to_bits().encode(out);
    }
}

impl Canonical for bool {
    fn encode(&self, out: &mut Vec<u8>) {
        out.push(u8::from(*self));
    }
}

impl Canonical for str {
    fn encode(&self, out: &mut Vec<u8>) {
        self.len().encode(out);
        out.extend_from_slice(self.as_bytes());
    }
}

impl Canonical for String {
    fn encode(&self, out: &mut Vec<u8>) {
        self.as_str().encode(out);
    }
}

impl<T: Canonical + ?Sized> Canonical for &T {
    fn encode(&self, out: &mut Vec<u8>) {
        (**self).encode(out);
    }
}

impl<T: Canonical + ?Sized> Canonical for Arc<T> {
    fn encode(&self, out: &mut Vec<u8>) {
        (**self).encode(out);
    }
}

impl<T: Canonical> Canonical for [T] {
    fn encode(&self, out: &mut Vec<u8>) {
        self.len().encode(out);
        for x in self {
            x.encode(out);
        }
    }
}

impl<T: Canonical, const N: usize> Canonical for [T; N] {
    fn encode(&self, out: &mut Vec<u8>) {
        for x in self {
            x.encode(out);
        }
    }
}

impl<T: Canonical> Canonical for Vec<T> {
    fn encode(&self, out: &mut Vec<u8>) {
        self.as_slice().encode(out);
    }
}

impl<T: Canonical> Canonical for Option<T> {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            None => out.push(0),
            Some(x) => {
                out.push(1);
                x.encode(out);
            }
        }
    }
}

impl<K: Canonical, V: Canonical> Canonical for BTreeMap<K, V> {
    fn encode(&self, out: &mut Vec<u8>) {
        self.len().encode(out);
        for (k, v) in self {
            k.encode(out);
            v.encode(out);
        }
    }
}

macro_rules! tuple {
    ($($n:tt $t:ident),*) => {
        impl<$($t: Canonical),*> Canonical for ($($t,)*) {
            fn encode(&self, out: &mut Vec<u8>) {
                $(self.$n.encode(out);)*
            }
        }
    };
}
tuple!(0 A, 1 B);
tuple!(0 A, 1 B, 2 C);
tuple!(0 A, 1 B, 2 C, 3 D);
tuple!(0 A, 1 B, 2 C, 3 D, 4 E);
tuple!(0 A, 1 B, 2 C, 3 D, 4 E, 5 F);

/// Implements [`Canonical`] for a struct by its fields in the order listed, which is the order
/// it declares them.
#[macro_export]
macro_rules! canonical_fields {
    ($t:ty { $($f:tt),* $(,)? }) => {
        impl $crate::schedule::Canonical for $t {
            fn encode(&self, out: &mut Vec<u8>) {
                $($crate::schedule::Canonical::encode(&self.$f, out);)*
            }
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Pair {
        name: String,
        at: [f64; 2],
    }
    canonical_fields!(Pair { name, at });

    #[test]
    fn fields_encode_in_order_with_strings_length_prefixed_and_floats_by_bits() {
        let bytes = Pair {
            name: "ab".into(),
            at: [1.5, -0.0],
        }
        .canonical_bytes();
        let mut want = 2u64.to_le_bytes().to_vec();
        want.extend_from_slice(b"ab");
        want.extend_from_slice(&1.5f64.to_bits().to_le_bytes());
        want.extend_from_slice(&(-0.0f64).to_bits().to_le_bytes());
        assert_eq!(bytes, want);
    }

    #[test]
    fn two_lists_split_differently_encode_differently() {
        let a: (Vec<String>, Vec<String>) = (vec!["ab".into()], vec!["c".into()]);
        let b: (Vec<String>, Vec<String>) = (vec!["a".into()], vec!["bc".into()]);
        assert_ne!(a.canonical_bytes(), b.canonical_bytes());
    }
}
