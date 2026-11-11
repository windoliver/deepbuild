//! The film viewer's keys (issue #501; canvas primitives: Transport: film viewer): one state
//! machine the app and the web player both drive. A key moves only the run-time transport, every
//! seek and pause lands on one of the film's own frames, and nothing here does I/O.

use deep_canvas::time::film_time;

/// The film a viewer plays: its transport's `start`, `span` and frame length, and where its
/// section markers start, all in flicks.
#[derive(Clone, Copy, Debug)]
pub struct Film<'a> {
    pub start: i64,
    pub span: i64,
    pub frame: i64,
    pub sections: &'a [i64],
}

/// The modifiers held with a key.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Mods {
    pub alt: bool,
    pub cmd: bool,
}

/// A viewer's run-time state. `volume` is in tenths and `keys` says the key list is shown.
#[derive(Clone, Debug)]
pub struct Viewer {
    /// Where play last started or was moved: (host time, film time).
    anchor: (i64, i64),
    pub rate: (i64, i64),
    pub muted: bool,
    pub volume: u8,
    pub keys: bool,
}

/// What a key asks of the transport or the host. A `Seek` or `Pause` time is a film frame's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Change {
    Seek(i64),
    Play,
    Pause(i64),
    Mute(bool),
    Volume(u8),
    FullScreen,
    Keys(bool),
}

/// The viewer's keys: (key, modifier `""` or `"alt"`, only while paused, what it does). The key
/// list shows this table and [`Viewer::key`] takes no key outside it.
pub const KEYS: &[(&str, &str, bool, &str)] = &[
    (" ", "", false, "play or pause"),
    ("k", "", false, "play or pause"),
    ("ArrowLeft", "", false, "back 5 s"),
    ("ArrowRight", "", false, "forward 5 s"),
    ("j", "", false, "back 10 s"),
    ("l", "", false, "forward 10 s"),
    (",", "", true, "back one frame"),
    (".", "", true, "forward one frame"),
    ("Home", "", false, "first frame"),
    ("End", "", false, "last frame"),
    ("0", "", false, "0% of the span"),
    ("1", "", false, "10% of the span"),
    ("2", "", false, "20% of the span"),
    ("3", "", false, "30% of the span"),
    ("4", "", false, "40% of the span"),
    ("5", "", false, "50% of the span"),
    ("6", "", false, "60% of the span"),
    ("7", "", false, "70% of the span"),
    ("8", "", false, "80% of the span"),
    ("9", "", false, "90% of the span"),
    ("ArrowLeft", "alt", false, "previous section"),
    ("ArrowRight", "alt", false, "next section"),
    ("m", "", false, "mute"),
    ("ArrowUp", "", false, "volume up 10%"),
    ("ArrowDown", "", false, "volume down 10%"),
    ("f", "", false, "full screen"),
    ("?", "", false, "this list"),
];

impl Default for Viewer {
    fn default() -> Viewer {
        Viewer::new()
    }
}

impl Viewer {
    /// A viewer at rate 1, full volume, not muted, its key list hidden.
    pub fn new() -> Viewer {
        Viewer {
            anchor: (0, 0),
            rate: (1, 1),
            muted: false,
            volume: 10,
            keys: false,
        }
    }

    /// The film time at host time `host` while playing: the anchor's, plus the host time since
    /// it × the rate.
    pub fn position(&self, host: i64) -> i64 {
        let run = i128::from(host - self.anchor.0) * i128::from(self.rate.0);
        self.anchor.1 + run.div_euclid(i128::from(self.rate.1)) as i64
    }

    /// One key at host time `host`. `paused` is the film time the transport is paused at, or
    /// `None` while it plays. `None` back: the viewer leaves the key to the app.
    pub fn key(&mut self, key: &str, mods: Mods, host: i64, paused: Option<i64>, film: &Film) -> Option<Change> {
        if mods.cmd {
            return None;
        }
        let modifier = if mods.alt { "alt" } else { "" };
        let &(_, _, only_paused, _) = KEYS.iter().find(|k| k.0 == key && k.1 == modifier)?;
        if only_paused && paused.is_none() {
            return None;
        }
        let last = film.start + film.span - 1;
        let snap = |t: i64| film_time(t.min(last).max(film.start), film.start, film.frame);
        // The frame on screen.
        let now = snap(paused.unwrap_or_else(|| self.position(host)));
        let second = crate::FLICKS;
        let to = match key {
            " " | "k" if paused.is_some() => {
                self.anchor = (host, now);
                return Some(Change::Play);
            }
            " " | "k" => return Some(Change::Pause(now)),
            "m" => {
                self.muted = !self.muted;
                return Some(Change::Mute(self.muted));
            }
            "ArrowUp" => {
                self.volume = self.volume.saturating_add(1).min(10);
                return Some(Change::Volume(self.volume));
            }
            "ArrowDown" => {
                self.volume = self.volume.saturating_sub(1);
                return Some(Change::Volume(self.volume));
            }
            "f" => return Some(Change::FullScreen),
            "?" => {
                self.keys = !self.keys;
                return Some(Change::Keys(self.keys));
            }
            // A section starts on its marker's frame; the next one is strictly after this frame.
            "ArrowLeft" if mods.alt => film.sections.iter().map(|&m| snap(m)).filter(|&s| s < now).max()?,
            "ArrowRight" if mods.alt => film.sections.iter().map(|&m| snap(m)).filter(|&s| s > now).min()?,
            "ArrowLeft" => now - 5 * second,
            "ArrowRight" => now + 5 * second,
            "j" => now - 10 * second,
            "l" => now + 10 * second,
            "," => now - film.frame,
            "." => now + film.frame,
            "Home" => film.start,
            "End" => last,
            digit => {
                let tenths = i128::from(digit.parse::<u8>().ok()?);
                film.start + (i128::from(film.span) * tenths / 10) as i64
            }
        };
        let to = snap(to);
        self.anchor = (host, to);
        Some(Change::Seek(to))
    }

    /// Plays at `p/q` from host time `host` on, or refuses a rate outside 1/4 to 2.
    pub fn set_rate(&mut self, p: i64, q: i64, host: i64) -> Result<(), String> {
        let (wide_p, wide_q) = (i128::from(p), i128::from(q));
        if p <= 0 || q <= 0 || 4 * wide_p < wide_q || wide_p > 2 * wide_q {
            return Err(format!("rate {p}/{q} is outside 1/4 to 2"));
        }
        self.anchor = (host, self.position(host));
        self.rate = (p, q);
        Ok(())
    }

    /// The sound's gain: silent when muted or away from rate 1, else the volume.
    pub fn gain(&self) -> f32 {
        if self.muted || self.rate.0 != self.rate.1 {
            0.0
        } else {
            f32::from(self.volume) / 10.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One frame at 30000/1001 fps.
    const FRAME: i64 = 23_543_520;
    const START: i64 = 1_000;
    const NONE: Mods = Mods { alt: false, cmd: false };
    const ALT: Mods = Mods { alt: true, cmd: false };

    /// Frame `k`'s time in a film of 601 frames.
    fn at(k: i64) -> i64 {
        START + k * FRAME
    }

    fn film(sections: &[i64]) -> Film<'_> {
        Film { start: START, span: 601 * FRAME, frame: FRAME, sections }
    }

    /// The seek `key` gives a fresh viewer paused at `paused`.
    fn seek(key: &str, mods: Mods, paused: i64, sections: &[i64]) -> Option<Change> {
        Viewer::new().key(key, mods, 0, Some(paused), &film(sections))
    }

    #[test]
    fn a_frame_step_moves_one_frame_and_only_while_paused() {
        assert_eq!(seek(".", NONE, at(100), &[]), Some(Change::Seek(at(101))));
        assert_eq!(seek(",", NONE, at(100), &[]), Some(Change::Seek(at(99))));
        assert_eq!(seek(".", NONE, at(600), &[]), Some(Change::Seek(at(600))));
        assert_eq!(seek(",", NONE, at(0), &[]), Some(Change::Seek(at(0))));
        let mut v = Viewer::new();
        assert_eq!(v.key(".", NONE, 0, None, &film(&[])), None);
        assert_eq!(v.key(",", NONE, 0, None, &film(&[])), None);
    }

    #[test]
    fn a_pause_and_a_seek_land_on_a_film_frame() {
        let mut v = Viewer::new();
        assert_eq!(v.key("k", NONE, 50, Some(at(100)), &film(&[])), Some(Change::Play));
        let host = 50 + 2 * FRAME + FRAME / 2;
        assert_eq!(v.position(host), at(102) + FRAME / 2);
        assert_eq!(v.key(" ", NONE, host, None, &film(&[])), Some(Change::Pause(at(102))));
        // A seek while playing moves the anchor: play goes on from the frame it landed on.
        assert_eq!(v.key("ArrowRight", NONE, host, None, &film(&[])), Some(Change::Seek(at(251))));
        assert_eq!(v.position(host + 3 * FRAME), at(254));
        // 5 s is 149.85 frames at 30000/1001 and 10 s is 299.7: each floors to a frame.
        assert_eq!(seek("ArrowRight", NONE, at(0), &[]), Some(Change::Seek(at(149))));
        assert_eq!(seek("ArrowLeft", NONE, at(0), &[]), Some(Change::Seek(at(0))));
        assert_eq!(seek("l", NONE, at(0), &[]), Some(Change::Seek(at(299))));
        assert_eq!(seek("j", NONE, at(600), &[]), Some(Change::Seek(at(300))));
        assert_eq!(seek("l", NONE, at(600), &[]), Some(Change::Seek(at(600))));
    }

    #[test]
    fn a_digit_seeks_to_its_tenth_of_the_span_and_home_and_end_to_its_ends() {
        // Half of 601 frames is frame 300.5, and nine tenths frame 540.9.
        assert_eq!(seek("5", NONE, at(7), &[]), Some(Change::Seek(at(300))));
        assert_eq!(seek("9", NONE, at(7), &[]), Some(Change::Seek(at(540))));
        assert_eq!(seek("0", NONE, at(7), &[]), Some(Change::Seek(at(0))));
        assert_eq!(seek("Home", NONE, at(7), &[]), Some(Change::Seek(at(0))));
        assert_eq!(seek("End", NONE, at(7), &[]), Some(Change::Seek(at(600))));
    }

    #[test]
    fn a_section_key_lands_on_the_marker_s_first_frame_strictly_past_this_one() {
        let sections = [at(0), at(200) + FRAME / 3, at(400)];
        assert_eq!(seek("ArrowRight", ALT, at(100), &sections), Some(Change::Seek(at(200))));
        assert_eq!(seek("ArrowRight", ALT, at(200), &sections), Some(Change::Seek(at(400))));
        assert_eq!(seek("ArrowRight", ALT, at(400), &sections), None);
        assert_eq!(seek("ArrowLeft", ALT, at(250), &sections), Some(Change::Seek(at(200))));
        assert_eq!(seek("ArrowLeft", ALT, at(200), &sections), Some(Change::Seek(at(0))));
        assert_eq!(seek("ArrowLeft", ALT, at(0), &sections), None);
    }

    #[test]
    fn a_key_with_cmd_held_or_outside_the_table_is_left_to_the_app() {
        let mut v = Viewer::new();
        let cmd = Mods { alt: false, cmd: true };
        assert_eq!(v.key("k", cmd, 0, Some(at(3)), &film(&[])), None);
        assert_eq!(v.key("m", cmd, 0, Some(at(3)), &film(&[])), None);
        assert!(!v.muted);
        assert_eq!(v.key("x", NONE, 0, Some(at(3)), &film(&[])), None);
        assert_eq!(v.key("k", ALT, 0, Some(at(3)), &film(&[])), None);
    }

    #[test]
    fn volume_moves_in_tenths_between_zero_and_ten_and_mute_silences_it() {
        let mut v = Viewer::new();
        let press = |v: &mut Viewer, key: &str| v.key(key, NONE, 0, Some(at(3)), &film(&[]));
        assert_eq!(press(&mut v, "ArrowUp"), Some(Change::Volume(10)));
        assert_eq!(press(&mut v, "ArrowDown"), Some(Change::Volume(9)));
        assert_eq!(v.gain(), 0.9);
        assert_eq!(press(&mut v, "m"), Some(Change::Mute(true)));
        assert_eq!(v.gain(), 0.0);
        assert_eq!(press(&mut v, "m"), Some(Change::Mute(false)));
        for _ in 0..12 {
            press(&mut v, "ArrowDown");
        }
        assert_eq!(press(&mut v, "ArrowDown"), Some(Change::Volume(0)));
        assert_eq!(press(&mut v, "f"), Some(Change::FullScreen));
        assert_eq!(press(&mut v, "?"), Some(Change::Keys(true)));
        assert_eq!(press(&mut v, "?"), Some(Change::Keys(false)));
    }

    #[test]
    fn a_rate_is_between_a_quarter_and_two_and_silent_away_from_one() {
        let mut v = Viewer::new();
        assert!(v.set_rate(1, 8, 0).unwrap_err().contains("1/8"));
        assert!(v.set_rate(3, 1, 0).unwrap_err().contains("3/1"));
        assert!(v.set_rate(0, 1, 0).is_err());
        assert_eq!(v.rate, (1, 1));
        assert_eq!(v.gain(), 1.0);
        v.key("k", NONE, 0, Some(at(100)), &film(&[]));
        // Ten frames at rate 1, then four frames of host time at half rate.
        assert_eq!(v.set_rate(1, 2, 10 * FRAME), Ok(()));
        assert_eq!(v.gain(), 0.0);
        assert_eq!(v.position(14 * FRAME), at(112));
        assert_eq!(v.set_rate(1, 4, 14 * FRAME), Ok(()));
        assert_eq!(v.set_rate(2, 1, 14 * FRAME), Ok(()));
        assert_eq!(v.position(15 * FRAME), at(114));
    }

    #[test]
    fn the_table_holds_each_of_the_issue_s_keys_once_and_every_entry_is_taken() {
        let mut listed: Vec<(String, &str)> = [" ", "k", "ArrowLeft", "ArrowRight", "j", "l", ",", ".", "Home", "End"]
            .iter()
            .chain(&["m", "ArrowUp", "ArrowDown", "f", "?"])
            .map(|k| (k.to_string(), ""))
            .collect();
        listed.extend((0..10).map(|d| (d.to_string(), "")));
        listed.extend([("ArrowLeft".to_string(), "alt"), ("ArrowRight".to_string(), "alt")]);
        assert_eq!(KEYS.len(), listed.len());
        let sections = [at(0), at(400)];
        for (key, modifier) in listed {
            let rows: Vec<_> = KEYS.iter().filter(|k| k.0 == key && k.1 == modifier).collect();
            assert_eq!(rows.len(), 1, "{modifier} {key:?}");
            assert_eq!(rows[0].2, key == "," || key == ".", "{key:?}");
            let mods = Mods { alt: modifier == "alt", cmd: false };
            assert!(seek(&key, mods, at(100), &sections).is_some(), "{modifier} {key:?}");
        }
    }
}
