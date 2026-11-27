use std::env;

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

pub(crate) fn reported() -> String {
    let billing = BILLING_KEYS
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
    format!(",\"billing\":{{{billing}}},\"route\":{{{route}}}")
}
