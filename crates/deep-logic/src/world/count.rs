//! #182, #853: what a logic item reads of what another canvas module's steps recorded.

use crate::piece::Read;
use crate::track::Given;

/// Fills a read's bytes from the last value recorded before the step's time: a world's reading
/// as an i32 of 0 or 1, a published count as an i32, a published mean place as three f64. With
/// none the bytes stay zeros.
pub(super) fn fill(last: Option<&Given>, read: &Read, bytes: &mut [u8]) {
    match (last, read) {
        (Some(Given::Vector(v)), Read::Centre) => {
            for (x, at) in v.iter().zip(bytes.as_chunks_mut::<8>().0) {
                *at = x.to_le_bytes();
            }
        }
        (Some(Given::Number(n)), Read::Count) => {
            bytes[..4].copy_from_slice(&(*n as i32).to_le_bytes());
        }
        (Some(Given::Number(n)), Read::World) => {
            bytes[..4].copy_from_slice(&i32::from(*n != 0.0).to_le_bytes());
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_count_is_an_i32_a_mean_place_three_f64_and_nothing_recorded_leaves_zeros() {
        let mut word = [0xffu8; 4];
        fill(Some(&Given::Number(511.0)), &Read::Count, &mut word);
        assert_eq!(i32::from_le_bytes(word), 511);
        fill(Some(&Given::Number(511.0)), &Read::World, &mut word);
        assert_eq!(i32::from_le_bytes(word), 1, "a world's reading is 0 or 1");
        let mut place = [0u8; 24];
        fill(
            Some(&Given::Vector(vec![0.5, -1.25, 3.0])),
            &Read::Centre,
            &mut place,
        );
        let read: Vec<f64> = (place.as_chunks::<8>().0.iter())
            .map(|b| f64::from_le_bytes(*b))
            .collect();
        assert_eq!(read, [0.5, -1.25, 3.0]);
        let mut none = [0u8; 24];
        fill(None, &Read::Centre, &mut none);
        assert_eq!(none, [0u8; 24]);
    }
}
