use std::env;

use crate::{hub_plant, quoted};

const BILLING_KEYS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "OPENAI_API_KEY",
];

const ROUTE_KEYS: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_BEDROCK_BASE_URL",
    "ANTHROPIC_VERTEX_BASE_URL",
    "ANTHROPIC_FOUNDRY_BASE_URL",
    "ANTHROPIC_AWS_BASE_URL",
    "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
    "ANTHROPIC_GOOGLE_CLOUD_BASE_URL",
    "OPENAI_BASE_URL",
];

pub(crate) fn session_start_fields(event: &str) -> String {
    if event != "SessionStart" {
        return String::new();
    }
    let keys = BILLING_KEYS
        .iter()
        .map(|key| {
            let value = env::var(key).unwrap_or_default().to_ascii_lowercase();
            let set = if key.starts_with("CLAUDE_CODE_USE_") {
                matches!(value.as_str(), "1" | "true" | "yes" | "on")
            } else {
                !value.is_empty()
            };
            format!("\"{key}\":{set}")
        })
        .collect::<Vec<_>>()
        .join(",");
    let route = ROUTE_KEYS
        .iter()
        .map(|key| {
            format!(
                "\"{key}\":{}",
                env::var_os(key).is_some_and(|v| !v.is_empty())
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let inbox = env::var("CLAUDE_CODE_MESSAGING_SOCKET")
        .ok()
        .filter(|path| !path.is_empty())
        .map(|path| format!(",\"inbox\":{}", quoted(&path)))
        .unwrap_or_default();
    let token = match hub_plant().as_deref() {
        Some("session-start-reports-token") => env::var("CLAUDE_CODE_MESSAGING_TOKEN")
            .map(|token| format!(",\"inbox_token\":{}", quoted(&token)))
            .unwrap_or_default(),
        _ => String::new(),
    };
    format!(",\"billing\":{{{keys}}},\"route\":{{{route}}}{inbox}{token}")
}
