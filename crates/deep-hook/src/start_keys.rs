//! What SessionStart reports of the environment the agent gave this process: whether each billing and route key is
//! set, never its value (#1886).
use std::env;

/// The environment variables that make an agent bill an API account instead of your plan.
const BILLING_KEYS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "OPENAI_API_KEY",
];

/// The environment variables that move the route to an agent's model off its own, beside the billing keys that do:
/// the agent's adapter reads the route from both.
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

/// The request's `billing` and `route` members, each key's name and whether it is set.
pub(crate) fn reported() -> String {
    let billing = BILLING_KEYS
        .iter()
        .map(|key| {
            // A key counts when set; a CLAUDE_CODE_USE_ switch only when on, as Claude Code reads it.
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
    format!(",\"billing\":{{{billing}}},\"route\":{{{route}}}")
}
