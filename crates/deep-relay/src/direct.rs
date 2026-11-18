//! The direct path between two copies of a match in the app (#549; canvas primitives: Net: relay
//! and Join): where both copies' network allows it, a match's frames go straight between them and
//! the relay sees only their joining. The lower-numbered copy listens on the address it reaches
//! the relay from and tells the other through the relay's `signal`, with an offer drawn for that
//! match; the other connects and names the match and the offer, and a connection that names
//! another is dropped. A copy that hears no signal, or can't connect, plays through the relay.
//! Frames cross as they are, each after its length (u32, little-endian).

use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

use serde_json::{json, Value};

use crate::wire::{self, MatchId};

/// How long a copy waits for the other's side of the handshake.
const HANDSHAKE: Duration = Duration::from_secs(2);

/// 16 bytes from the platform's secure random source: a match ID, or a direct path's offer.
pub fn random16() -> Result<[u8; 16], String> {
    let mut bytes = [0; 16];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .map_err(|e| format!("the platform's secure random source can't be read: {e}"))?;
    Ok(bytes)
}

/// One copy's end of a direct path.
pub struct Peer {
    stream: TcpStream,
    buf: Vec<u8>,
    /// The other copy's address, as this copy's log names it.
    pub host: String,
}

impl Peer {
    fn new(stream: TcpStream, host: String) -> Result<Peer, String> {
        stream.set_nodelay(true).map_err(|e| e.to_string())?;
        stream.set_nonblocking(true).map_err(|e| e.to_string())?;
        Ok(Peer {
            stream,
            buf: Vec::new(),
            host,
        })
    }

    /// Connects to the address a `signal` gave and names the match, the offer and this copy's
    /// player; the path is up once the listener answers.
    pub fn connect(address: &str, game: &MatchId, offer: &str, player: u8) -> Result<Peer, String> {
        let fail = |what: String| format!("no direct path to {address}: {what}");
        let addr: SocketAddr = address.parse().map_err(|_| fail("not an address".into()))?;
        let mut stream =
            TcpStream::connect_timeout(&addr, HANDSHAKE).map_err(|e| fail(e.to_string()))?;
        let hello = json!({"direct": {"match": wire::hex(game), "offer": offer, "player": player}});
        stream
            .write_all(format!("{hello}\n").as_bytes())
            .map_err(|e| fail(e.to_string()))?;
        match line(&mut stream) {
            Some(answer) if answer["direct"] == json!("ok") => {
                Peer::new(stream, address.to_string())
            }
            _ => Err(fail("the other copy didn't take the offer".into())),
        }
    }

    pub fn send(&mut self, frame: &[u8]) -> Result<(), String> {
        let mut bytes = (frame.len() as u32).to_le_bytes().to_vec();
        bytes.extend_from_slice(frame);
        let mut at = 0;
        while at < bytes.len() {
            match self.stream.write(&bytes[at..]) {
                Ok(0) => return Err(format!("the direct path to {} closed", self.host)),
                Ok(n) => at += n,
                Err(e) if e.kind() == ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_micros(200))
                }
                Err(e) => return Err(format!("the direct path to {} dropped: {e}", self.host)),
            }
        }
        Ok(())
    }

    /// The frames that have arrived, in order; an error once the other copy is gone.
    pub fn receive(&mut self) -> Result<Vec<Vec<u8>>, String> {
        let mut chunk = [0; 16_384];
        let mut gone = None;
        loop {
            match self.stream.read(&mut chunk) {
                Ok(0) => {
                    gone = Some(format!("the direct path to {} closed", self.host));
                    break;
                }
                Ok(n) => self.buf.extend_from_slice(&chunk[..n]),
                Err(e) if e.kind() == ErrorKind::WouldBlock => break,
                Err(e) => {
                    gone = Some(format!("the direct path to {} dropped: {e}", self.host));
                    break;
                }
            }
        }
        let mut frames = Vec::new();
        while let Some(len) = self.buf.get(..4) {
            let len = u32::from_le_bytes([len[0], len[1], len[2], len[3]]) as usize;
            if len as u64 > wire::FRAME_BYTES {
                return Err(format!(
                    "the direct path to {} sent a frame past relay@1's size",
                    self.host
                ));
            }
            if self.buf.len() < 4 + len {
                break;
            }
            frames.push(self.buf[4..4 + len].to_vec());
            self.buf.drain(..4 + len);
        }
        match (frames.is_empty(), gone) {
            (true, Some(why)) => Err(why),
            _ => Ok(frames),
        }
    }
}

/// One JSON line, read a byte at a time so nothing past it is taken.
fn line(stream: &mut TcpStream) -> Option<Value> {
    stream.set_read_timeout(Some(HANDSHAKE)).ok()?;
    let mut bytes = Vec::new();
    let mut byte = [0];
    while bytes.len() < 512 {
        stream.read_exact(&mut byte).ok()?;
        if byte[0] == b'\n' {
            return serde_json::from_slice(&bytes).ok();
        }
        bytes.push(byte[0]);
    }
    None
}

/// The listening copy's side: its address and the offer it drew for this match.
pub struct Listener {
    listener: TcpListener,
    pub address: String,
    pub offer: String,
}

impl Listener {
    /// Listens on `local`, the address this copy reaches the relay from.
    pub fn open(local: IpAddr) -> Result<Listener, String> {
        let listener = TcpListener::bind((local, 0)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let address = listener
            .local_addr()
            .map_err(|e| e.to_string())?
            .to_string();
        Ok(Listener {
            listener,
            address,
            offer: wire::hex(&random16()?),
        })
    }

    /// A copy that connected and named this match and its offer: its player and the path.
    pub fn accept(&mut self, game: &MatchId) -> Option<(u8, Peer)> {
        let (mut stream, from) = self.listener.accept().ok()?;
        stream.set_nonblocking(false).ok()?;
        let hello = line(&mut stream)?;
        let d = &hello["direct"];
        if d["match"] != json!(wire::hex(game)) || d["offer"] != json!(self.offer) {
            return None;
        }
        let player = d["player"].as_u64().filter(|p| (1..=8).contains(p))? as u8;
        stream.write_all(b"{\"direct\":\"ok\"}\n").ok()?;
        Some((player, Peer::new(stream, from.to_string()).ok()?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_cross_a_direct_path_whole_and_another_offer_is_dropped() {
        let game = [9; 16];
        let mut listener = Listener::open("127.0.0.1".parse().unwrap()).unwrap();
        let address = listener.address.clone();
        let offer = listener.offer.clone();
        let wrong = std::thread::spawn({
            let address = address.clone();
            move || Peer::connect(&address, &[9; 16], "00", 2).is_err()
        });
        let accept = |l: &mut Listener| loop {
            if let Some(p) = l.accept(&game) {
                return p;
            }
            std::thread::sleep(Duration::from_millis(5));
        };
        let right = std::thread::spawn(move || Peer::connect(&address, &[9; 16], &offer, 2));
        let (player, mut here) = accept(&mut listener);
        assert!(
            wrong.join().unwrap(),
            "a connection naming another offer is dropped"
        );
        let mut there = right.join().unwrap().unwrap();
        assert_eq!(player, 2);
        there.send(&[1, 2, 3]).unwrap();
        there.send(&[]).unwrap();
        here.send(&[7; 40_000]).unwrap();
        let mut got = Vec::new();
        while got.len() < 2 {
            got.extend(here.receive().unwrap());
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(got, vec![vec![1, 2, 3], vec![]]);
        let mut back = Vec::new();
        while back.is_empty() {
            back.extend(there.receive().unwrap());
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(back, vec![vec![7; 40_000]]);
        drop(there);
        std::thread::sleep(Duration::from_millis(20));
        assert!(here.receive().is_err(), "a copy that is gone ends the path");
        assert_ne!(random16().unwrap(), random16().unwrap());
    }
}
