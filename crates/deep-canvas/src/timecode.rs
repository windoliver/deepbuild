//! Timecode labels (issue #501; canvas primitives: Export). Frame n's label is a closed form of
//! n and the frame rate: `HH:MM:SS:FF`, or `HH:MM:SS;FF` when drop-frame skips frame numbers so
//! the label keeps pace with the clock at 30000/1001 and 60000/1001.

/// A frame rate's timecode: `nominal` frames a labelled second, and `drop` frame numbers skipped
/// at each minute that is not a tenth minute (0, 2 or 4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Timecode {
    pub nominal: u32,
    pub drop: u32,
}

/// The timecode of `p/q` fps, or why there is none: drop-frame exists only at 30000/1001 and
/// 60000/1001.
pub fn of_rate(p: u32, q: u32, drop_frame: bool) -> Result<Timecode, String> {
    let (wide_p, wide_q) = (u64::from(p), u64::from(q));
    // p ÷ q rounded to the nearest whole frame count.
    let nominal = if q == 0 {
        0
    } else {
        ((2 * wide_p + wide_q) / (2 * wide_q)) as u32
    };
    if nominal == 0 {
        return Err(format!("frame rate {p}/{q} has no timecode"));
    }
    let drop = match drop_frame {
        false => 0,
        true if wide_p * 1001 == 30_000 * wide_q => 2,
        true if wide_p * 1001 == 60_000 * wide_q => 4,
        true => {
            return Err(format!(
                "drop_frame is accepted only at 30000/1001 and 60000/1001, not at {p}/{q}"
            ))
        }
    };
    Ok(Timecode { nominal, drop })
}

impl Timecode {
    /// Frame `n`'s label.
    pub fn label(&self, n: u64) -> String {
        let (nominal, drop) = (u64::from(self.nominal), u64::from(self.drop));
        let mut n = n;
        if drop > 0 {
            // A minute holds `minute` frames after its drop, and ten minutes `ten`: only nine of
            // them drop.
            let minute = nominal * 60 - drop;
            let ten = 10 * minute + drop;
            let (d, m) = (n / ten, n % ten);
            n += 9 * drop * d;
            if m >= drop {
                n += drop * ((m - drop) / minute);
            }
        }
        let seconds = n / nominal;
        let sep = if drop > 0 { ';' } else { ':' };
        format!(
            "{:02}:{:02}:{:02}{sep}{:02}",
            seconds / 3600,
            seconds / 60 % 60,
            seconds % 60,
            n % nominal
        )
    }

    /// The frame number `label` names, or why it names none. Either separator before the frames
    /// is read, so a start written `00:00:00:00` serves a drop-frame export.
    pub fn number(&self, label: &str) -> Result<u64, String> {
        let bad = || {
            format!(
                "timecode {label:?} is not HH:MM:SS:FF at {} frames a second",
                self.nominal
            )
        };
        let (head, last) = label.rsplit_once([':', ';']).ok_or_else(bad)?;
        let fields: Vec<&str> = head.split(':').chain([last]).collect();
        let mut part = [0u128; 4];
        if fields.len() != 4 {
            return Err(bad());
        }
        for (slot, field) in part.iter_mut().zip(fields) {
            if !field.bytes().all(|b| b.is_ascii_digit()) {
                return Err(bad());
            }
            *slot = field.parse::<u64>().map_err(|_| bad())?.into();
        }
        let [hours, minutes, seconds, frames] = part;
        let (nominal, drop) = (u128::from(self.nominal), u128::from(self.drop));
        if minutes >= 60 || seconds >= 60 || frames >= nominal {
            return Err(bad());
        }
        let whole_minutes = hours * 60 + minutes;
        if seconds == 0 && frames < drop && whole_minutes % 10 != 0 {
            return Err(format!("timecode {label:?} names a dropped frame number"));
        }
        let counted = (whole_minutes * 60 + seconds) * nominal + frames;
        u64::try_from(counted - drop * (whole_minutes - whole_minutes / 10)).map_err(|_| bad())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drop_frame_skips_two_or_four_numbers_a_minute_but_not_at_the_tenth() {
        let thirty = of_rate(30_000, 1001, true).unwrap();
        assert_eq!(
            thirty,
            Timecode {
                nominal: 30,
                drop: 2
            }
        );
        assert_eq!(thirty.label(1_799), "00:00:59;29");
        assert_eq!(thirty.label(1_800), "00:01:00;02");
        assert_eq!(thirty.label(17_982), "00:10:00;00");
        let sixty = of_rate(60_000, 1001, true).unwrap();
        assert_eq!(sixty.label(35_964), "00:10:00;00");
        assert_eq!(sixty.label(3_600), "00:01:00;04");
        assert_eq!(
            of_rate(30_000, 1001, false).unwrap().label(1_800),
            "00:01:00:00"
        );
    }

    #[test]
    fn a_label_and_its_frame_number_are_inverses() {
        let film = of_rate(24, 1, false).unwrap();
        assert_eq!(film.number("01:00:00:00"), Ok(86_400));
        assert_eq!(film.label(86_400 + 239), "01:00:09:23");
        assert_eq!(film.label(86_400 + 48), "01:00:02:00");
        for tc in [
            film,
            of_rate(30_000, 1001, true).unwrap(),
            of_rate(60_000, 1001, true).unwrap(),
        ] {
            for n in (0..40_000).chain([107_892, 2_589_407]) {
                assert_eq!(tc.number(&tc.label(n)), Ok(n), "{tc:?} frame {n}");
            }
        }
    }

    #[test]
    fn a_rate_without_drop_frame_and_a_label_that_names_no_frame_are_refused() {
        assert!(of_rate(24_000, 1001, true)
            .unwrap_err()
            .contains("24000/1001"));
        assert!(of_rate(30, 1, true).unwrap_err().contains("30/1"));
        assert_eq!(
            of_rate(24_000, 1001, false),
            Ok(Timecode {
                nominal: 24,
                drop: 0
            })
        );
        assert!(of_rate(0, 1, false).is_err());
        let drop = of_rate(30_000, 1001, true).unwrap();
        assert_eq!(drop.number("00:00:00:00"), Ok(0));
        assert!(drop
            .number("00:01:00;01")
            .unwrap_err()
            .contains("00:01:00;01"));
        assert_eq!(drop.number("00:10:00;01"), Ok(17_983));
        for label in [
            "01:00:00",
            "00:00:00:30",
            "00:60:00:00",
            "00:00;00:00",
            "0a:00:00:00",
            "",
        ] {
            assert!(drop.number(label).is_err(), "{label}");
        }
    }
}
