//! #549: a piece's match in the web player (canvas primitives: Net: relay and Join). The page
//! draws the Join prompt and owns the one connection, the viewer's browser's WebSocket to the
//! declared relay, opened only by a person's click; everything it says and reads comes from here:
//! the prompt's words, the relay's hello checked before anything is sent, the join, and the copy
//! of the lockstep match, stepped on this player's own logic. The web has no direct path, so its
//! frames go through the relay.

use std::rc::Rc;

use deep_canvas::registry::Sealed;
use deep_logic::piece::Piece;
use deep_net::card::{self, Card};
use deep_net::prompt::{self, State};
use deep_net::{Config, Copy, End, Planted, FLICKS};
use deep_play::net::Logic;
use deep_relay::wire::{self, MatchId};
use serde_json::{json, Value};

pub struct Match {
    cfg: Config,
    /// #551: the document, whose worlds the copy steps beside its logic items.
    source: Value,
    card: Card,
    piece: Option<Rc<Piece>>,
    track: Vec<Value>,
    state: State,
    game: Option<MatchId>,
    /// This copy drew the match ID: its join opens the match and its link is the first player's.
    open: bool,
    me: Option<u8>,
    copy: Option<Copy<Logic>>,
    /// When the copy's next frame may go: one a match step.
    next_frame: i64,
}

/// #552: 64 bits from the browser's secure random source, `crypto.getRandomValues`.
fn secure_u64() -> u64 {
    use wasm_bindgen::JsCast as _;
    let buf = js_sys::Uint8Array::new_with_length(8);
    let crypto = js_sys::Reflect::get(&js_sys::global(), &"crypto".into()).ok();
    let fill = crypto
        .as_ref()
        .and_then(|c| js_sys::Reflect::get(c, &"getRandomValues".into()).ok())
        .and_then(|f| f.dyn_into::<js_sys::Function>().ok());
    if let (Some(c), Some(f)) = (crypto, fill) {
        let _ = f.call1(&c, &buf);
    }
    let mut b = [0u8; 8];
    buf.copy_to(&mut b);
    u64::from_le_bytes(b)
}

/// The page's clock, in ms, as flicks.
fn flicks(ms: f64) -> i64 {
    (ms * (FLICKS / 1000) as f64).round() as i64
}

impl Match {
    /// The match `source` declares, if its net item names a relay: `form` is the played form,
    /// `piece` its logic items, and the document and the recorded track are named by the SHA-256
    /// of their files in the bundle.
    pub fn of(
        sealed: &Sealed,
        source: &Value,
        piece: Option<Piece>,
        track: &[Value],
        document: &str,
        recorded: &str,
    ) -> Option<Match> {
        let cfg = Config::of(source).filter(|c| !c.host.is_empty())?;
        Some(Match {
            source: source.clone(),
            card: Card::of(sealed, source, document.to_string(), recorded.to_string()),
            cfg,
            piece: piece.map(Rc::new),
            track: track.to_vec(),
            state: State::Open,
            game: None,
            open: false,
            me: None,
            copy: None,
            next_frame: 0,
        })
    }

    /// The prompt as the page draws it.
    pub fn prompt(&self) -> Value {
        prompt::prompt(
            &self.cfg.host,
            self.cfg.players,
            self.cfg.courtesy,
            &self.state,
        )
    }

    fn refuse(&mut self, refused: Value, why: String) -> Value {
        self.state = State::Refused(refused, why);
        json!({})
    }

    /// A person clicked Join. `link` is the page's own link, whose fragment carries the first
    /// player's match when this copy joins one; `drawn` is 16 bytes from the browser's secure
    /// random source, the ID of a match this copy opens. It answers the URL to open, or nothing
    /// when the Join is refused before anything is opened.
    pub fn join(&mut self, link: &str, drawn: MatchId) -> Value {
        if self.state != State::Open {
            return json!({});
        }
        if self.piece.is_none() {
            let why = "This piece holds no logic item for a match to step.".to_string();
            return self.refuse(json!("unsupported"), why);
        }
        match card::parse(link) {
            Some((game, theirs)) => {
                if let Some(m) = self.card.differs(&theirs) {
                    return self.refuse(m.to_json(), m.text());
                }
                self.game = Some(game);
            }
            None => {
                self.game = Some(drawn);
                self.open = true;
            }
        }
        self.state = State::Joined;
        json!({"url": format!("wss://{}/", self.cfg.host), "step_ms": 1000.0 / self.cfg.step_rate as f64})
    }

    /// A control message from the relay, at the page's time `now_ms`: what to send back, or
    /// that the connection is to close.
    pub fn control(&mut self, text: &str, now_ms: f64) -> Value {
        let Ok(m) = serde_json::from_str::<Value>(text) else {
            return json!({});
        };
        let host = self.cfg.host.clone();
        if let Some(hello) = m.get("hello") {
            // A relay that answers another protocol or digest is refused before anything is sent.
            let limits = match wire::check_hello(&host, hello) {
                Ok(l) => l,
                Err(why) => {
                    self.refuse(json!("relay"), why);
                    return json!({"close": true});
                }
            };
            if (limits.frames_per_s as i64) < self.cfg.step_rate {
                let why = format!(
                    "refused the relay {host}: its hello allows {} frames a second, and this match needs {}, one a match step",
                    limits.frames_per_s, self.cfg.step_rate
                );
                self.refuse(json!("relay"), why);
                return json!({"close": true});
            }
            let Some(game) = self.game else {
                return json!({"close": true});
            };
            let join = json!({"join": {"match": wire::hex(&game), "players": self.cfg.players, "open": self.open}});
            return json!({"send": join.to_string()});
        }
        if let Some(player) = m.pointer("/joined/player").and_then(Value::as_u64) {
            self.me = Some(player as u8 + 1);
        } else if let Some(reason) = m.get("refused").and_then(Value::as_str) {
            self.state = prompt::refused_by_relay(&host, reason);
            return json!({"close": true});
        } else if m.get("start").is_some() {
            self.start(flicks(now_ms));
        } else if let Some(c) = m.get("closed") {
            let player = c["player"].as_u64().unwrap_or(0) as u8 + 1;
            match self.copy.as_mut() {
                Some(copy) => copy.closed(player, c["reason"].as_str().unwrap_or("left")),
                None => self.state = State::Ended("left".into()),
            }
        }
        json!({})
    }

    /// Every seat is taken: this copy's match starts, on the page's clock from `now`.
    fn start(&mut self, now: i64) {
        let (Some(me), Some(game), Some(piece), None) =
            (self.me, self.game, self.piece.clone(), &self.copy)
        else {
            return;
        };
        match Logic::new(piece, &self.track, false)
            .and_then(|mut l| l.worlds(&self.source).map(|()| l))
        {
            Ok(sim) => {
                let mut copy = Copy::new(
                    self.cfg.clone(),
                    self.card.clone(),
                    me,
                    self.cfg.players,
                    game,
                    sim,
                    Planted::None,
                    now,
                );
                // #552: a draw's bits come from the browser's secure random source.
                copy.draw_source(Box::new(secure_u64), Default::default());
                self.copy = Some(copy);
                self.next_frame = now;
            }
            Err(e) => {
                self.refuse(
                    json!("unsupported"),
                    format!("The piece's logic doesn't start: {e}"),
                );
            }
        }
    }

    /// A frame another copy sent arrived.
    pub fn receive(&mut self, frame: &[u8], now_ms: f64) {
        if let Some(copy) = self.copy.as_mut() {
            copy.receive(frame, flicks(now_ms));
        }
    }

    /// #551: a person's key on the page while the match plays: an entry of this copy's player on
    /// each control whose `keys` name it (Control: `keys: {key → value}`), as a person's input in
    /// the app is. Whether it made one.
    pub fn key(&mut self, key: &str) -> bool {
        let Some(copy) = self.copy.as_mut().filter(|c| c.end().is_none()) else {
            return false;
        };
        let controls = self.source.get("controls").and_then(Value::as_object);
        let mut made = false;
        for (id, c) in controls.into_iter().flatten() {
            if let Some(value) = c.get("keys").and_then(|k| k.get(key)) {
                copy.make(id, value.clone());
                made = true;
            }
        }
        made
    }

    /// The page's tick: runs what is due and gives the frame to send, one a match step at most;
    /// empty when there is none.
    pub fn tick(&mut self, now_ms: f64) -> Vec<u8> {
        let now = flicks(now_ms);
        let Some(copy) = self.copy.as_mut() else {
            return Vec::new();
        };
        if now < self.next_frame {
            return Vec::new();
        }
        let step = self.cfg.step();
        self.next_frame = (self.next_frame + step).max(now - step);
        let frame = copy.tick(now).unwrap_or_default();
        // #550: a desync keeps the connection until the copies have located it.
        if let (Some(end), true) = (copy.end(), copy.done()) {
            self.state = State::Ended(end.name().to_string());
        }
        frame
    }

    /// The connection ended: a match still going ends as left.
    pub fn disconnected(&mut self) {
        if let Some(copy) = self.copy.as_mut() {
            copy.leave();
            self.state = State::Ended(copy.end().map_or("left", End::name).to_string());
        } else if self.state == State::Joined {
            self.state = State::Ended("left".into());
        }
    }

    /// The player this copy has waited 0.25 s or more for, 0 when none: the page shows its own
    /// notice naming it, never the piece.
    pub fn waiting(&self, now_ms: f64) -> u8 {
        let shown = self.copy.as_ref().filter(|c| c.end().is_none());
        shown
            .and_then(|c| c.shown(flicks(now_ms)).1)
            .map_or(0, |(player, _)| player)
    }

    /// Whether the match has ended, so the page closes its connection.
    pub fn ended(&self) -> bool {
        matches!(self.state, State::Ended(_) | State::Refused(..))
    }

    /// What `probe().match` gives: the copy's report once the match started, with the prompt's
    /// state, the match ID and, for the copy that opened it, the fragment of the first player's
    /// link; the page writes the link around it.
    pub fn probe(&self) -> Value {
        let mut out = match &self.copy {
            Some(copy) => Value::Object(copy.report()),
            None => json!({}),
        };
        out["state"] = json!(self.state.name());
        if let Some(game) = &self.game {
            out["match"] = json!(wire::hex(game));
            if self.open && self.me.is_some() {
                out["fragment"] = json!(card::fragment(game, &self.card));
            }
        }
        out
    }
}
