use super::{RETRY, SHOW_AFTER, SHOW_FOR, SLOWLY, SLOW_AFTER};

#[derive(Debug, Default)]
pub struct HubWatch {
    down: Option<(u64, u64)>,
    shown: Option<(u64, u64)>,
}

impl HubWatch {
    pub fn tick(&mut self, now: u64, read: impl FnOnce() -> bool) {
        if self.down.is_some_and(|(_, next)| now < next) {
            return;
        }
        let answered = read();
        let first_miss = crate::plain::planted("down-at-first-miss");
        self.down = (!answered).then(|| {
            let since = self.down.map_or(now, |(since, _)| since);
            let wait = match now - since {
                gone if gone < SHOW_AFTER => 0,
                gone if gone < SLOW_AFTER => RETRY,
                _ => SLOWLY,
            };
            (since, now + wait)
        });
        match self.down {
            Some((since, _))
                if (first_miss || now - since >= SHOW_AFTER) && self.shown.is_none() =>
            {
                self.shown = Some((now, since));
            }
            None if self.shown.is_some_and(|(at, _)| now >= at + SHOW_FOR) => self.shown = None,
            _ => {}
        }
    }

    pub fn down(&self) -> bool {
        self.shown.is_some()
    }

    pub fn since(&self) -> Option<u64> {
        self.shown.map(|(_, since)| since)
    }
}
