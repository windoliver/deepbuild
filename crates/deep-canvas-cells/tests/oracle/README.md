# Oracle recordings for #1967

Issue #1967's Oracle page links an upstream terminal's ref tests: each feeds a recorded byte stream to a terminal and
compares the grid with a stored one. #136's rule applies: a linked test counts only when run against our output. So
`recording::tests::upstream_recordings_play_as_a_live_grid_fed_the_same_bytes_shows_them` (in `src/recording.rs`)
cuts each stream below into 97-byte chunks a quarter second apart, converts it as a terminal recording, and checks that
at every chunk's time, and just before the next, the grid it plays equals this crate's live emulator fed the same
bytes up to then. That is the criterion's "its grid equals a live grid fed the same bytes". The upstream's stored grids
aren't compared: they judge an emulator's fidelity, which isn't this issue's criterion, and aren't copied.

| Folder | What the stream is |
|---|---|
| `history` | output that scrolls into history |
| `hyperlinks` | OSC 8 links |
| `scroll_in_region_up_preserves_history` | a scroll region scrolled up |
| `sgr` | the pen's attributes and colors |
| `tmux_htop` | a process viewer inside a terminal multiplexer |
| `vim_simple_edit` | an editor on the alternate screen |
| `vttest_scroll` | a terminal test program's scroll tests |
| `wrapline_alt_toggle` | wrapped lines while the alternate screen toggles |

Each folder holds `recording` (the upstream's `alacritty.recording`) and `size.json` (its `columns` and
`screen_lines`), from alacritty at commit `94e7c8874e526b1e67b349d9ba30ddf81669119e`,
`alacritty_terminal/tests/ref/<folder>/`. The user and host names in the recorded shell prompts are replaced with
placeholders of the same length (`user0`, `host00`, …), so no cursor position moves.

The recordings are the Alacritty Project's test data, licensed under the Apache License, Version 2.0
(<http://www.apache.org/licenses/LICENSE-2.0>), as alacritty's `LICENSE-APACHE` gives it.
