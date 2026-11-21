// Planted wrong program for #2470 AC1 (tests/acceptance/2470/twins/README.md): a binary of deep-contracts that defines
// RULE_340 and RULE_341 twice, as the two merged regenerations left them in src/generated.rs. Cargo finds a file in
// src/bin/ on its own, so `cargo check --locked -p deep-contracts` fails on it with the issue's error, E0428.
static RULE_340: u8 = 0;
static RULE_340: u8 = 1;
static RULE_341: u8 = 0;
static RULE_341: u8 = 1;

fn main() {}
