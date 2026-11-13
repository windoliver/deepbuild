//! Issue #1454: the app as a device you paired (design: The trusted path is a device you paired). Its first answer
//! makes an Ed25519 key and pairs it with the hub, which has the OS confirm you. From then on the app signs what it sends.
//!
//! Issue #1606: the key lives in the OS secret store (keystore.rs), never in a file, and is taken out of it only to make
//! one signature. A key an older app kept in `~/.deepbuild/app/device.json` moves there once, at the app's next start,
//! and the file is deleted.
//!
//! Issue #1579: a signature says what it's for, as the hub's one verifier checks it (packages/hub/src/trusted.ts):
//! `signature: {signed: {device, method, hub, at, once, params}, sig}`, Ed25519 over the RFC 8785 bytes of `signed`,
//! where `params` is the hex SHA-256 of the params' RFC 8785 bytes. So it counts for that method on that hub, for 10
//! minutes, once.

use std::io::Read as _;
use std::path::PathBuf;

use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::{json, Map, Value};
use sha2::{Digest as _, Sha256};

use crate::hub::{HubClient, HubError};

const NAME: &str = "DeepBuild on this Mac";
const KEY_BYTES: usize = 32;
/// A once-only ID's random bytes: 22 base64url characters.
const ONCE_BYTES: usize = 16;

/// The device the app paired as: its ID at the hub. Its key stays in the OS secret store.
pub struct Device {
    id: String,
}

/// Where an older app kept its device, `{ "device", "seed" }`, before #1606.
fn file() -> PathBuf {
    crate::hub::root().join("app").join("device.json")
}

/// The device as the store keeps it, `{ "device", "seed" }`: its ID and its key.
fn read(text: &str) -> Option<(String, SigningKey)> {
    let kept: Value = serde_json::from_str(text).ok()?;
    let seed = decode(kept["seed"].as_str()?)?;
    Some((
        kept["device"].as_str()?.to_owned(),
        SigningKey::from_bytes(&<[u8; KEY_BYTES]>::try_from(seed).ok()?),
    ))
}

impl Device {
    /// The device this home paired, if any.
    fn kept() -> Option<Device> {
        let (id, _) = read(&crate::keystore::get()?)?;
        Some(Device { id })
    }

    /// Moves a key an older app kept in a file into the store, once, and deletes the file. Called as the app starts.
    pub fn moved() {
        // The planted wrong program keeps its key in that file, as the base did, and never moves one.
        if cfg!(feature = "plant-key-in-file") {
            return;
        }
        let path = file();
        let Ok(text) = std::fs::read_to_string(&path) else {
            return;
        };
        // A file that holds no key, or one the store already replaced, only goes; a key goes into the store first.
        if read(&text).is_some() && crate::keystore::get().is_none() {
            if let Err(error) = crate::keystore::set(&text) {
                eprintln!(
                    "deep-app: {} still holds the device key: {error}",
                    path.display()
                );
                return;
            }
        }
        match std::fs::remove_file(&path) {
            Ok(()) => eprintln!(
                "deep-app: moved the device key from {} into the OS secret store and deleted the file",
                path.display()
            ),
            Err(error) => eprintln!("deep-app: couldn't delete {}: {error}", path.display()),
        }
    }

    /// Makes a key and pairs it: the hub has the OS confirm you first, so a key alone never pairs.
    fn pair(client: &mut HubClient) -> Result<Device, HubError> {
        let mut seed = [0u8; KEY_BYTES];
        std::fs::File::open("/dev/urandom")?.read_exact(&mut seed)?;
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
        crate::keystore::set(&json!({ "device": id, "seed": encode(&seed) }).to_string())?;
        drop(key);
        Ok(Device { id })
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
        crate::keystore::delete();
    }

    /// `params` with a signature for `method` on the hub `hub`, over exactly those params, now and once.
    pub fn sign(
        &self,
        method: &str,
        hub: &str,
        params: Map<String, Value>,
    ) -> Result<Value, HubError> {
        let mut once = [0u8; ONCE_BYTES];
        std::fs::File::open("/dev/urandom")?.read_exact(&mut once)?;
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.as_millis() as u64);
        // The key comes out of the store for this one signature and is dropped, zeroed, with it.
        let (id, key) = crate::keystore::get()
            .as_deref()
            .and_then(read)
            .filter(|(id, _)| *id == self.id)
            .ok_or_else(|| {
                HubError::Protocol(format!("the OS secret store holds no key for {}", self.id))
            })?;
        Ok(signed(&key, &id, method, hub, at, &encode(&once), params))
    }
}

/// `params` with `key`'s signature as the device `id`, for `method` on the hub `hub`, at `at`, once as `once`.
fn signed(
    key: &SigningKey,
    id: &str,
    method: &str,
    hub: &str,
    at: u64,
    once: &str,
    mut params: Map<String, Value>,
) -> Value {
    let mut body = String::new();
    canonical(&Value::Object(params.clone()), &mut body);
    let signed = json!({
        "device": id,
        "method": method,
        "hub": hub,
        "at": at,
        "once": once,
        "params": format!("{:x}", Sha256::digest(body.as_bytes())),
    });
    let mut bytes = String::new();
    canonical(&signed, &mut bytes);
    let sig = encode(&key.sign(bytes.as_bytes()).to_bytes());
    params.insert("signature".into(), json!({ "signed": signed, "sig": sig }));
    Value::Object(params)
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
    fn a_signature_covers_the_method_the_hub_the_time_the_once_and_the_params() {
        let key = SigningKey::from_bytes(&[7; KEY_BYTES]);
        let mut params = Map::new();
        params.insert("ask".into(), json!("ask:01A"));
        params.insert("option".into(), json!("yes"));
        let sent = signed(
            &key,
            "device:01ABC",
            "ask.answer",
            "abc",
            1_700_000_000_000,
            "AAAAAAAAAAAAAAAAAAAAAA",
            params.clone(),
        );
        let signature = &sent["signature"];
        let mut body = String::new();
        canonical(&Value::Object(params), &mut body);
        assert_eq!(
            signature["signed"],
            json!({ "device": "device:01ABC", "method": "ask.answer", "hub": "abc", "at": 1_700_000_000_000u64,
                    "once": "AAAAAAAAAAAAAAAAAAAAAA", "params": format!("{:x}", Sha256::digest(body.as_bytes())) })
        );
        let sig = decode(signature["sig"].as_str().unwrap()).unwrap();
        let sig = Signature::from_slice(&sig).unwrap();
        let mut bytes = String::new();
        canonical(&signature["signed"], &mut bytes);
        assert!(key.verifying_key().verify(bytes.as_bytes(), &sig).is_ok());
        let mut other = signature["signed"].clone();
        other["method"] = json!("ask.undo");
        let mut moved = String::new();
        canonical(&other, &mut moved);
        assert!(key.verifying_key().verify(moved.as_bytes(), &sig).is_err());
    }
}
