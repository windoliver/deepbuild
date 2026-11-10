Dark theme, `deep-canvas-render look` resolved roles. Before: ground `#0b0c0e`, raised `#0d0e10`. After: ground `#040405`, raised `#0d0e10`.

**Raised against ground:** before 1.013:1, after 1.061:1 (relative luminance gap 0.0007 → 0.0031).

### Contrast on every fill (WCAG 2.x, alpha blended in sRGB and rounded to bytes)

| Role | Floor | ground | raised | hover over ground | hover over raised | selected over ground | selected over raised |
|---|---|---|---|---|---|---|---|
| `ink_primary` | 4.5 | 17.62 → 18.46 | 17.39 → 17.39 | 17.15 → 18.03 | 16.88 → 16.88 | 16.74 → 17.71 | 16.46 → 16.46 |
| `ink_secondary` | 4.5 | 12.43 → 12.87 | 12.26 → 12.26 | 12.21 → 12.58 | 12.02 → 12.02 | 11.92 → 12.49 | 11.72 → 11.72 |
| `ink_tertiary` | 3.0 | 5.23 → 5.25 | 5.23 → 5.23 | 5.22 → 5.27 | 5.21 → 5.21 | 5.24 → 5.25 | 5.22 → 5.22 |
| `ink_disabled` | none | 1.72 → 1.65 | 1.75 → 1.75 | 1.75 → 1.68 | 1.78 → 1.78 | 1.79 → 1.71 | 1.79 → 1.79 |
| `focus` | 3.0 | 4.38 → 4.59 | 4.32 → 4.32 | 4.26 → 4.48 | 4.20 → 4.20 | 4.16 → 4.40 | 4.09 → 4.09 |
| `pass` (status) | 3.0 | 3.29 → 3.45 | 3.25 → 3.25 | 3.20 → 3.37 | 3.15 → 3.15 | 3.12 → 3.31 | 3.07 → 3.07 |
| `fail` (status) | 3.0 | 3.25 → 3.41 | 3.21 → 3.21 | 3.16 → 3.33 | 3.12 → 3.12 | 3.09 → 3.27 | 3.04 → 3.04 |
| `invalid` (status) | 3.0 | 3.25 → 3.41 | 3.21 → 3.21 | 3.17 → 3.33 | 3.12 → 3.12 | 3.09 → 3.27 | 3.04 → 3.04 |
| `blocked` (status) | 3.0 | 3.24 → 3.40 | 3.20 → 3.20 | 3.15 → 3.32 | 3.11 → 3.11 | 3.08 → 3.26 | 3.03 → 3.03 |
| `inconclusive` (status) | 3.0 | 3.23 → 3.38 | 3.19 → 3.19 | 3.14 → 3.30 | 3.09 → 3.09 | 3.07 → 3.25 | 3.02 → 3.02 |
| `running` (status) | 3.0 | 3.24 → 3.39 | 3.20 → 3.20 | 3.15 → 3.31 | 3.10 → 3.10 | 3.08 → 3.26 | 3.02 → 3.02 |
| `needs_you` (status) | 3.0 | 3.27 → 3.42 | 3.23 → 3.23 | 3.18 → 3.35 | 3.13 → 3.13 | 3.11 → 3.29 | 3.05 → 3.05 |
| `stale` (status) | 3.0 | 3.27 → 3.43 | 3.23 → 3.23 | 3.18 → 3.35 | 3.13 → 3.13 | 3.11 → 3.29 | 3.05 → 3.05 |
| `idle` (status) | 3.0 | 3.30 → 3.45 | 3.25 → 3.25 | 3.21 → 3.37 | 3.16 → 3.16 | 3.13 → 3.31 | 3.08 → 3.08 |

### Status distance (OKLab, floor 0.1): the closest status for each role the guard measures

| Role | Over | Before | After |
|---|---|---|---|
| `raised` | opaque | 0.3356 (stale) | 0.3356 (stale) |
| `divider` | opaque | 0.2093 (stale) | 0.2093 (stale) |
| `ink_primary` | opaque | 0.4616 (idle) | 0.4616 (idle) |
| `accent` | opaque | 0.1829 (running) | 0.1829 (running) |
| `session_readout` | opaque | 0.2349 (invalid) | 0.2349 (invalid) |
| `session_line` | opaque | 0.1228 (running) | 0.1228 (running) |
| `focus` | opaque | 0.1228 (running) | 0.1228 (running) |
| `ink_secondary` | ground | 0.3489 (idle) | 0.3455 (idle) |
| `ink_secondary` | raised | 0.3489 (idle) | 0.3489 (idle) |
| `ink_tertiary` | ground | 0.1108 (idle) | 0.1004 (idle) |
| `ink_tertiary` | raised | 0.1142 (idle) | 0.1142 (idle) |
| `ink_disabled` | ground | 0.1542 (idle) | 0.1769 (idle) |
| `ink_disabled` | raised | 0.1464 (idle) | 0.1464 (idle) |
| `hover` | ground | 0.3264 (stale) | 0.3640 (stale) |
| `hover` | raised | 0.3174 (stale) | 0.3174 (stale) |
| `selected` | ground | 0.3130 (stale) | 0.3486 (stale) |
| `selected` | raised | 0.3041 (stale) | 0.3041 (stale) |

### Terminal colors on the terminal background (the ground; floor 3.0)

| Role | Before | After |
|---|---|---|
| `term_black` | 5.82 | 6.09 |
| `term_blue` | 5.60 | 5.86 |
| `term_bright_black` | 7.76 | 8.12 |
| `term_bright_blue` | 7.76 | 8.12 |
| `term_bright_cyan` | 8.48 | 8.88 |
| `term_bright_green` | 9.80 | 10.27 |
| `term_bright_magenta` | 6.70 | 7.01 |
| `term_bright_red` | 7.76 | 8.13 |
| `term_bright_white` | 18.43 | 19.30 |
| `term_bright_yellow` | 16.78 | 17.57 |
| `term_cyan` | 7.01 | 7.34 |
| `term_green` | 7.82 | 8.19 |
| `term_magenta` | 5.01 | 5.25 |
| `term_red` | 5.76 | 6.03 |
| `term_white` | 13.46 | 14.10 |
| `term_yellow` | 12.33 | 12.91 |
