//! The expression tokenizer: how `Tokens` reads a text's next token.

use super::*;

impl Iterator for Tokens {
    type Item = Result<String, String>;

    fn next(&mut self) -> Option<Result<String, String>> {
        let chars = &self.chars;
        let mut i = self.i;
        while chars.get(i).is_some_and(|c| c.is_whitespace()) {
            i += 1;
        }
        let c = *chars.get(i)?;
        let next = chars.get(i + 1).copied();
        let start = i;
        let t = if c.is_ascii_digit() || (c == '.' && next.is_some_and(|d| d.is_ascii_digit())) {
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            // A word that starts with a digit, such as `3d` or `0.5s`, is one token (#142).
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            Ok(chars[start..i].iter().collect())
        } else if c.is_ascii_alphabetic() || c == '_' {
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            Ok(chars[start..i].iter().collect())
        } else if let Some(two) = next
            .map(|d| format!("{c}{d}"))
            .filter(|t| ["==", "!=", "<=", ">=", "&&", "||"].contains(&t.as_str()))
        {
            i += 2;
            Ok(two)
        } else if "+-*/%(),[].?:<>!".contains(c) {
            i += 1;
            Ok(c.to_string())
        } else {
            i = chars.len();
            Err(format!("unexpected `{c}`"))
        };
        self.i = i;
        Some(t)
    }
}
