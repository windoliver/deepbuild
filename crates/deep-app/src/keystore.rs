//! Issue #1606: the device's key lives in the OS secret store, never in a file. On macOS it is a Keychain item the app
//! makes, whose access trusts only the app that made it (the Keychain's default for an item with no access given), so
//! another program running as you meets a refusal or the OS's prompt, and reading every file under `~/.deepbuild` gives
//! no key. Each home's hub has its own item, named by the home's `.deepbuild` folder. The app asks for the key only to
//! sign, and drops it at once.

use std::path::PathBuf;

/// The Keychain item's service; its account is the hub root the device paired with.
#[cfg(target_os = "macos")]
const SERVICE: &str = "DeepBuild device key";

fn account() -> String {
    crate::hub::root().to_string_lossy().into_owned()
}

/// What the store keeps for this home's device, or None.
pub fn get() -> Option<String> {
    if cfg!(feature = "plant-key-in-file") {
        return std::fs::read_to_string(planted()).ok();
    }
    if let Some(file) = stand_in() {
        let all: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
        return all[account()].as_str().map(str::to_owned);
    }
    os::get(&account())
}

/// Keeps `text` for this home's device, in place of what was kept.
pub fn set(text: &str) -> std::io::Result<()> {
    if cfg!(feature = "plant-key-in-file") {
        std::fs::create_dir_all(crate::hub::root().join("app"))?;
        return write_private(&planted(), text);
    }
    if let Some(file) = stand_in() {
        let mut all: serde_json::Value = std::fs::read_to_string(&file)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        all[account()] = serde_json::Value::String(text.to_owned());
        return write_private(&file, &all.to_string());
    }
    os::set(&account(), text)
}

/// Lets go of this home's device.
pub fn delete() {
    if cfg!(feature = "plant-key-in-file") {
        let _ = std::fs::remove_file(planted());
        return;
    }
    if let Some(file) = stand_in() {
        let Some(mut all) = std::fs::read_to_string(&file)
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        else {
            return;
        };
        if let Some(map) = all.as_object_mut() {
            map.remove(&account());
        }
        let _ = write_private(&file, &all.to_string());
        return;
    }
    os::delete(&account());
}

/// The file a test names in the store's place, in a build with `test-secrets` alone: no test touches your Keychain,
/// and the shipped app holds no such word.
#[cfg(feature = "test-secrets")]
fn stand_in() -> Option<PathBuf> {
    std::env::var_os("DEEP_APP_TEST_SECRETS").map(PathBuf::from)
}
#[cfg(not(feature = "test-secrets"))]
fn stand_in() -> Option<PathBuf> {
    None
}

/// The planted wrong program's store (`plant-key-in-file`, in no shipped build): the base's file under the hub's root.
fn planted() -> PathBuf {
    crate::hub::root().join("app").join("device.json")
}

fn write_private(path: &std::path::Path, text: &str) -> std::io::Result<()> {
    use std::io::Write as _;
    use std::os::unix::fs::OpenOptionsExt as _;
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

#[cfg(target_os = "macos")]
mod os {
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    pub fn get(account: &str) -> Option<String> {
        String::from_utf8(get_generic_password(super::SERVICE, account).ok()?).ok()
    }
    pub fn set(account: &str, text: &str) -> std::io::Result<()> {
        set_generic_password(super::SERVICE, account, text.as_bytes()).map_err(|e| {
            std::io::Error::other(format!("the Keychain didn't keep the device key: {e}"))
        })
    }
    pub fn delete(account: &str) {
        let _ = delete_generic_password(super::SERVICE, account);
    }
}

/// The Secret Service through secret-tool: the value on its standard input and output, never on a command line. The
/// store is reached only off the UI thread: the card signs on a thread of its own (answer.rs), and the move runs before
/// the window's loop starts.
#[cfg(not(target_os = "macos"))]
mod os {
    use std::io::Write as _;
    use std::process::{Command, Stdio};

    const TOOL: &str = "/usr/bin/secret-tool";
    fn item(account: &str) -> [&str; 4] {
        ["service", "deepbuild.device", "account", account]
    }
    pub fn get(account: &str) -> Option<String> {
        let mut lookup = Command::new(TOOL);
        lookup.arg("lookup").args(item(account));
        // blocking call: off the UI thread, as above.
        let out = lookup.output().ok()?;
        (out.status.success() && !out.stdout.is_empty())
            .then(|| String::from_utf8(out.stdout).ok())?
    }
    pub fn set(account: &str, text: &str) -> std::io::Result<()> {
        let mut child = Command::new(TOOL)
            .args(["store", "--label=DeepBuild device key"])
            .args(item(account))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .spawn()?;
        child
            .stdin
            .take()
            .expect("piped")
            .write_all(text.as_bytes())?;
        // blocking call: off the UI thread, as above.
        if child.wait()?.success() {
            Ok(())
        } else {
            Err(std::io::Error::other(
                "the Secret Service didn't keep the device key",
            ))
        }
    }
    pub fn delete(account: &str) {
        // blocking call: off the UI thread, as above.
        let _ = Command::new(TOOL).arg("clear").args(item(account)).status();
    }
}
