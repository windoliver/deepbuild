//! The paths a tool call names past the agents' own file tools: a path as pi's file tools open it, and the paths an MCP
//! call's arguments name (#1848), which path guards read as they read an Edit's or a Read's.

use std::fs;
use std::path::{Path, PathBuf};

use deep_contracts::{parse, Value};

use crate::member;

/// A path as pi's file tools open it (pi's `normalizePath`): its unicode spaces plain, without one leading `@`, a bare
/// `~` the home folder, and a `file://` URL the path it names.
pub fn pi_path(path: &str) -> String {
    let spaced: String = path
        .chars()
        .map(|c| match c {
            '\u{00A0}' | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}' => ' ',
            c => c,
        })
        .collect();
    let bare = spaced.strip_prefix('@').unwrap_or(&spaced);
    if bare == "~" {
        return "~/".to_string();
    }
    match bare.strip_prefix("file://") {
        Some(url) => file_url_path(url),
        None => bare.to_string(),
    }
}

/// What Node's `fileURLToPath` makes of a `file://` URL's rest: the URL parser ends it at a `?` or `#`, drops tabs and
/// newlines and what trails it and reads `\` as `/`; then it is percent-decoded. Any host is passed over: Node opens the
/// path under one that decodes to `localhost` however it is spelled, and throws on the rest, so nothing else opens.
fn file_url_path(url: &str) -> String {
    let clean: String = url
        .trim_end_matches(|c: char| c <= ' ')
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .map(|c| if c == '\\' { '/' } else { c })
        .collect();
    let path = clean.split(['?', '#']).next().unwrap_or("");
    let path = path.find('/').map_or(path, |slash| &path[slash..]);
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = (bytes[i] == b'%')
            .then(|| path.get(i + 1..i + 3))
            .flatten()
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match hex {
            Some(byte) => {
                out.push(byte);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The MCP servers' facts as this build ships them: a server they list may name which of a tool's arguments hold paths.
const MCP_FACTS: &str = include_str!("../../../adapters/mcp-servers.facts.json");

/// DeepBuild's own MCP servers, as `deep setup` names them for Claude Code (`deepbuild`, `deep-actions`) and as Codex and
/// pi name the deep_* tools (`deep`). They act through the hub, which checks the paths they name itself, and
/// `deep_propose`, where a guard's denial points, may name the spec it would change.
const OWN_SERVERS: &[&str] = &["deepbuild", "deep", "deep-actions"];

/// The paths an `mcp__<server>__<tool>` call's arguments name, each after its argument; None for any other tool and for
/// DeepBuild's own servers. Every string in them counts, a nested one named by its place (`files[0].path`), with no
/// whitespace, as an absolute path, one under `~/` or one relative to the call's folder. When the MCP servers' facts
/// name the tool's path arguments, only those count, whatever they hold.
pub fn mcp(
    tool: &str,
    input: Option<&Value>,
    cwd: Option<&Path>,
    home: &Path,
) -> Option<Vec<(String, String)>> {
    fn strings(value: &Value, at: String, out: &mut Vec<(String, String)>) {
        match value {
            Value::String(text) => out.push((at, text.clone())),
            Value::Array(items) => {
                for (k, item) in items.iter().enumerate() {
                    strings(item, format!("{at}[{k}]"), out);
                }
            }
            Value::Object(fields) => {
                for (key, item) in fields {
                    let at = if at.is_empty() {
                        key.clone()
                    } else {
                        format!("{at}.{key}")
                    };
                    strings(item, at, out);
                }
            }
            _ => {}
        }
    }
    let (server, tool) = tool.strip_prefix("mcp__")?.split_once("__")?;
    if OWN_SERVERS.contains(&server) {
        return None;
    }
    let mut found = Vec::new();
    if let Some(input) = input {
        strings(input, String::new(), &mut found);
    }
    // The planted wrong program for #1848's AC3 counts every string as a path, whatever it holds or the facts name.
    match path_args(server, tool, cwd, home) {
        _ if cfg!(feature = "plant-every-string-a-path") => {}
        Some(listed) => found.retain(|(arg, _)| {
            listed.iter().any(|name| {
                arg == name
                    || arg
                        .strip_prefix(name.as_str())
                        .is_some_and(|rest| rest.starts_with(['[', '.']))
            })
        }),
        None => found.retain(|(_, text)| !text.is_empty() && !text.contains(char::is_whitespace)),
    }
    Some(found)
}

/// The arguments of `server`'s `tool` that hold paths, when the MCP servers' facts name them and the agent loads that
/// server as they describe it, as the hub reads them (packages/hub/src/mcp-servers.ts): from a scope they list, with
/// the config they match. None when every string argument counts.
fn path_args(server: &str, tool: &str, cwd: Option<&Path>, home: &Path) -> Option<Vec<String>> {
    let facts = parse(MCP_FACTS).ok()?;
    let known = member(member(&facts, "servers")?, server)?;
    let Value::Array(listed) = member(member(member(known, "tools")?, tool)?, "paths")? else {
        return None;
    };
    let (scope, config) = source(server, cwd?, home)?;
    let scoped = matches!(member(known, "scopes"), Some(Value::Array(s)) if s.contains(&Value::String(scope.into())));
    let fits = match member(known, "match") {
        Some(Value::Object(fields)) => fields.iter().all(|(k, v)| member(&config, k) == Some(v)),
        _ => true,
    };
    (scoped && fits).then(|| {
        listed
            .iter()
            .filter_map(|n| match n {
                Value::String(name) => Some(name.clone()),
                _ => None,
            })
            .collect()
    })
}

/// The config Claude Code loads `server` from in `cwd`, and its scope: your local config, the repo's .mcp.json when you
/// approved it there, else your user config.
fn source(server: &str, cwd: &Path, home: &Path) -> Option<(&'static str, Value)> {
    let read = |file: PathBuf| {
        fs::read_to_string(file)
            .ok()
            .and_then(|text| parse(&text).ok())
    };
    let entry = |config: &Value| match member(member(config, "mcpServers")?, server)? {
        found @ Value::Object(_) => Some(found.clone()),
        _ => None,
    };
    let user = read(home.join(".claude.json"));
    let project = user
        .as_ref()
        .and_then(|u| member(member(u, "projects")?, cwd.to_str()?));
    if let Some(local) = project.and_then(entry) {
        return Some(("local", local));
    }
    let approved = project.is_some_and(|p| {
        member(p, "enableAllProjectMcpServers") == Some(&Value::Bool(true))
            || matches!(member(p, "enabledMcpjsonServers"), Some(Value::Array(a)) if a.contains(&Value::String(server.into())))
    });
    if let Some(shared) = read(cwd.join(".mcp.json"))
        .filter(|_| approved)
        .as_ref()
        .and_then(entry)
    {
        return Some(("project", shared));
    }
    user.as_ref().and_then(entry).map(|mine| ("user", mine))
}
