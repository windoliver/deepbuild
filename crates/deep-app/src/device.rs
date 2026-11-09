//! Issue #1454: the app as a device you paired (design: The trusted path is a device you paired). Its first answer
//! makes an Ed25519 key, kept under the hub's root and readable only by you, and pairs it with the hub, which has the
//! OS confirm you. From then on the app signs what it sends, as the hub checks it (packages/hub/src/trusted.ts).
//!
//! Issue #1579: a signature says what it's for. The params gain one field, `signature: { signed, sig }`, where `signed`
//! names the device, the method, the hub's ID from its hello, the time, a once-only ID and the SHA-256 of the params'
//! RFC 8785 bytes, and `sig` is Ed25519 over the RFC 8785 bytes of `signed`.

use std::io::Read as _;
use std::path::PathBuf;

use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::{json, Map, Value};
use sha2::{Digest as _, Sha256};

use crate::hub::{HubClient, HubError};

const NAME: &str = "DeepBuild on this Mac";
const KEY_BYTES: usize = 32;

/// The device the app paired as: its ID at the hub and its key.
pub struct Device {
    id: String,
    key: SigningKey,
}

/// Where the app keeps its device: `{ "device", "seed" }`, only you can read it.
fn file() -> PathBuf {
    crate::hub::root().join("app").join("device.json")
}

impl Device {
    /// The device this home paired, if any.
    fn kept() -> Option<Device> {
        let kept: Value = serde_json::from_str(&std::fs::read_to_string(file()).ok()?).ok()?;
        let seed = decode(kept["seed"].as_str()?)?;
        Some(Device {
            id: kept["device"].as_str()?.to_owned(),
            key: SigningKey::from_bytes(&<[u8; KEY_BYTES]>::try_from(seed).ok()?),
        })
    }

    /// Makes a key and pairs it: the hub has the OS confirm you first, so a key alone never pairs.
    fn pair(client: &mut HubClient) -> Result<Device, HubError> {
        let seed: [u8; KEY_BYTES] = random()?;
        let key = SigningKey::from_bytes(&seed);
        let public_key = encode(key.verifying_key().as_bytes());
        let reply = client.call(
            "device.pair",
            json!({ "name": NAME, "public_key": public_key }),
        )?;
        let id = reply["device"]
            .as_str()
            .ok_or_else(|| HubError::Protocol(format!("no device in {reply}")))?
            .to_owned();
        keep(&json!({ "device": id, "seed": encode(&seed) }).to_string())?;
        Ok(Device { id, key })
    }

    /// The device, paired now if this home has none.
    pub fn paired(client: &mut HubClient) -> Result<Device, HubError> {
        match Device::kept() {
            Some(device) => Ok(device),
            None => Device::pair(client),
        }
    }

    /// Lets go of a device the hub no longer knows, as after a restore: the next answer pairs again.
    pub fn forget() {
        let _ = std::fs::remove_file(file());
    }

    /// `params` signed for `method` on the hub whose hello names `hub`, now, once.
    pub fn sign(
        &self,
        method: &str,
        hub: &str,
        mut params: Map<String, Value>,
    ) -> Result<Value, HubError> {
        let mut body = String::new();
        canonical(&Value::Object(params.clone()), &mut body);
        let once: [u8; 16] = random()?;
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| HubError::Protocol(e.to_string()))?
            .as_millis() as u64;
        let signed = json!({
            "device": self.id, "method": method, "hub": hub, "at": at, "once": encode(&once),
            "params_hash": Sha256::digest(body.as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>(),
        });
        let mut bytes = String::new();
        canonical(&signed, &mut bytes);
        let sig = encode(&self.key.sign(bytes.as_bytes()).to_bytes());
        params.insert("signature".into(), json!({ "signed": signed, "sig": sig }));
        Ok(Value::Object(params))
    }
}

/// `N` random bytes from the OS.
fn random<const N: usize>() -> std::io::Result<[u8; N]> {
    let mut bytes = [0u8; N];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes)
}

/// Writes the device file, readable only by you from its first byte, as the control token is.
fn keep(text: &str) -> std::io::Result<()> {
    use std::io::Write as _;
    use std::os::unix::fs::OpenOptionsExt as _;
    let path = file();
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder)?;
    }
    let spare = path.with_extension("tmp");
    let mut out = std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&spare)?;
    out.write_all(text.as_bytes())?;
    std::fs::rename(spare, path)
}

/// RFC 8785 for what an answer's params hold: strings, integers, lists and objects, keys by UTF-16 code unit.
fn canonical(value: &Value, out: &mut String) {
    match value {
        Value::Array(items) => {
            out.push('[');
            for (at, item) in items.iter().enumerate() {
                if at > 0 {
                    out.push(',');
                }
                canonical(item, out);
            }
            out.push(']');
        }
        Value::Object(fields) => {
            let mut keys: Vec<&String> = fields.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            out.push('{');
            for (at, key) in keys.into_iter().enumerate() {
                if at > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                canonical(&fields[key.as_str()], out);
            }
            out.push('}');
        }
        other => out.push_str(&other.to_string()),
    }
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Base64url with no padding, as the hub reads a key and a signature.
fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 4 / 3 + 2);
    for chunk in bytes.chunks(3) {
        let word = chunk
            .iter()
            .fold(0u32, |word, byte| word << 8 | u32::from(*byte))
            << (8 * (3 - chunk.len()));
        for at in 0..=chunk.len() {
            out.push(ALPHABET[(word >> (18 - 6 * at) & 63) as usize] as char);
        }
    }
    out
}

fn decode(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut word, mut bits) = (0u32, 0);
    for byte in text.bytes() {
        word = word << 6 | ALPHABET.iter().position(|a| *a == byte)? as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((word >> bits) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier as _};

    #[test]
    fn base64url_matches_the_hubs_reading_of_a_key() {
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg");
        assert_eq!(encode(b"fo"), "Zm8");
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(&[0xfb, 0xff]), "-_8");
        for bytes in [&b""[..], b"f", b"fo", b"foo", &[0xfb, 0xff, 0, 1]] {
            assert_eq!(decode(&encode(bytes)).as_deref(), Some(bytes));
        }
    }

    #[test]
    fn canonical_bytes_order_keys_by_utf16_with_no_spaces() {
        let mut out = String::new();
        canonical(
            &json!({"z": 1, "é": [1, "a\"b"], "a": {"b": true, "\u{1F600}": null, "\u{FF5E}": 2}}),
            &mut out,
        );
        // U+1F600 is the pair D83D DE00, which sorts before U+FF5E by code unit, though after it by code point.
        assert_eq!(
            out,
            "{\"a\":{\"b\":true,\"\u{1F600}\":null,\"\u{FF5E}\":2},\"z\":1,\"é\":[1,\"a\\\"b\"]}"
        );
    }

    #[test]
    fn a_signature_covers_the_method_hub_time_once_and_params() {
        let key = SigningKey::from_bytes(&[7; KEY_BYTES]);
        let device = Device {
            id: "device:01ABC".into(),
            key: key.clone(),
        };
        let mut params = Map::new();
        params.insert("ask".into(), json!("ask:01A"));
        params.insert("option".into(), json!("yes"));
        let sent = device.sign("ask.answer", "hub-id", params.clone()).unwrap();
        assert!(sent.get("device").is_none());
        let signed = &sent["signature"]["signed"];
        assert_eq!(signed["device"], "device:01ABC");
        assert_eq!(signed["method"], "ask.answer");
        assert_eq!(signed["hub"], "hub-id");
        assert!(signed["at"].as_u64().unwrap() > 1_700_000_000_000);
        let mut body = String::new();
        canonical(&Value::Object(params.clone()), &mut body);
        let hash: String = Sha256::digest(body.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(signed["params_hash"], hash.as_str());
        let again = device.sign("ask.answer", "hub-id", params).unwrap();
        assert_ne!(signed["once"], again["signature"]["signed"]["once"]);
        let sig = decode(sent["signature"]["sig"].as_str().unwrap()).unwrap();
        let sig = Signature::from_slice(&sig).unwrap();
        let mut bytes = String::new();
        canonical(signed, &mut bytes);
        assert!(key.verifying_key().verify(bytes.as_bytes(), &sig).is_ok());
        let mut other = signed.clone();
        other["method"] = json!("ask.undo");
        let mut wrong = String::new();
        canonical(&other, &mut wrong);
        assert!(key.verifying_key().verify(wrong.as_bytes(), &sig).is_err());
    }
}
