//! A fixture app for #882's wrong-program tests, shaped like crates/deep-app/src: its views read every color from
//! the look's roles and hold no color literal. It is never compiled; the guards and inventories only read it.
pub mod views;
