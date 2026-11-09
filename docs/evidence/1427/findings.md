# #1427 proof: the motion check's findings

Each row is one `motion_check` answer from `deep-drive`; every answer also said "pacing not measured". Times are the replica's virtual clock since launch; values as the README of tests/acceptance/1427 defines them.

## Planted lab journeys (tests/acceptance/1427/fixtures/panels/motion-lab)

| Journey | Claim | Findings | Recording |
|---|---|---|---|
| Pop in | FAIL | `pop_in` on `pop-row` at 0.017 s, 1 | `6f959241c9d4` |
| Fade in | PASS | none | `0450c22c3bb6` |
| Jump | FAIL | `jump` on `jumper` at 0.017 s, 0.2813 | `3760114cfabc` |
| Fly | PASS | none | `a3269e73437e` |
| Overshoot | FAIL | `overshoot` on `overshooter` at 0.275 s, 1 | `2cd250541f53` |
| Spring | PASS | none | `e1a299c6c215` |
| Flicker 3 | FAIL | `flicker` on `badge` at 0.033 s, 3 | `5a5dfff93a33` |
| Flicker 2 | PASS | none | `f838fbbe0b32` |
| Drift long | FAIL | `no_settle` on `drifter` at 2.008 s, 2 | `b06405dcd366` |
| Drift short | PASS | none | `1251da8ac6e8` |
| Insert above (reader on Line B) | FAIL | `reader_moved` on `line-b` at 0.017 s, 40 | `b6ad647cd675` |
| Insert below (reader on Line B) | PASS | none | `81dfb0a202c8` |
| Drift short (reduced motion) | FAIL | `moved_under_reduced_motion` on `drifter` at 0.033 s, 30 | `a88110c8f573` |
| Fly (reduced motion) | PASS | none | `d60d82c89f64` |

## Shipped journeys

Claim: PASS. pacing not measured: virtual time proves the shape of motion, not native pacing.

| Journey | Claim | Findings | Recording |
|---|---|---|---|
| needs-you | PASS | none | `1fe756afac3f` |
| session | PASS | none | `3e9431258ef8` |
| project | PASS | none | `ddb628a692fc` |

## Shipped journeys, planted `jumps-on-act`

Claim: FAIL. pacing not measured: virtual time proves the shape of motion, not native pacing.

| Journey | Claim | Findings | Recording |
|---|---|---|---|
| needs-you | FAIL | `jump` on `root` at 0.017 s, 0.2999; `jump` on `dock-area` at 0.017 s, 0.2999; `jump` on `dock-area-center` at 0.017 s, 0.2999; `jump` on `tab-group` at 0.017 s, 0.2999; `jump` on `tab-group-content` at 0.017 s, 0.2999; `jump` on `line` at 0.017 s, 0.2999; `jump` on `line-status` at 0.017 s, 0.2999; `jump` on `needs-you` at 0.017 s, 0.2999; `jump` on `ask:01MCBHM300GP83QANM5WDCWNNP` at 0.017 s, 0.2999; `jump` on `ask:01MCBHNXK01C7MA759TY6A067E` at 0.017 s, 0.2999; `jump` on `ask:01MCBHQR604RSDCGT0XNF4YCAH` at 0.017 s, 0.2999; `jump` on `ask:01MCBHSJS0JPWS3RM039XYQSNS` at 0.017 s, 0.2999; `jump` on `ask:01MCBHVDC0Z4S4BBGH7GFPD952` at 0.017 s, 0.2999; `jump` on `ask:01MCBHX7Z0FNAJRF955NVKMG9M` at 0.017 s, 0.2999; `jump` on `ask:01MCBHZ2J04Z23DH6W50XQ2A84` at 0.017 s, 0.2999; `jump` on `ask:01MCBJ0X50EAQCQZ73BR8VEX8J` at 0.017 s, 0.2999; `jump` on `ask:01MCBJ2QR0QB676VKTSV2XNB40` at 0.017 s, 0.2999; `jump` on `ask:01MCBJ4JB0HVWNWEBJSDKJ3455` at 0.017 s, 0.2999; `jump` on `ask:01MCBJ87H07MNWWA7Q4AEDZN1C` at 0.017 s, 0.2999; `jump` on `ask:01MCBJA240SW17ZRA9J03NKYSW` at 0.017 s, 0.2999; `jump` on `ask:01MCBJBWQ0PEVQEWK18997336F` at 0.017 s, 0.2999; `jump` on `ask:01MCBJDQA0AQA7A53MHVBC3EFP` at 0.017 s, 0.2999; `jump` on `ask:01MCBJFHX0HBZPRXE7PB8WSP8Z` at 0.017 s, 0.2999; `jump` on `ask:01MCBJN1P00Y2QKCG37JSPXQKY` at 0.017 s, 0.2999; `jump` on `ask:01MCBJPW90WFPZM3KB5SC2EGT1` at 0.017 s, 0.2999; `jump` on `ask:01MCBJRPW0278W412Z0G9XCRFQ` at 0.017 s, 0.2999; `jump` on `ask:01MCBJTHF0G3F0RX9V9R3RAQQZ` at 0.017 s, 0.2999; `jump` on `ask:01MCBJWC206E670JH89MEG9QWN` at 0.017 s, 0.2999; `jump` on `ask:01MCBK0180861FYX1QB7D4FH40` at 0.017 s, 0.2999; `jump` on `ask:01MCBK1VV0C16MFYY0FV9VS2MC` at 0.017 s, 0.2999; `jump` on `ask:01MCBK3PE07YZ30D3DDGHH7TAH` at 0.017 s, 0.2999; `jump` on `ask:01MCBK5H10C35HRB0K1WQ7ZGW3` at 0.017 s, 0.2999; `jump` on `ask:01MCBK7BM0KJTAA4KEFCSDT2CA` at 0.017 s, 0.2999; `jump` on `ask:01MCBKB0T0KWE4C5CFPMHW4J7R` at 0.017 s, 0.2999; `jump` on `ask:01MCBKCVD0NQS534YAM1ZTMWJ2` at 0.017 s, 0.2999; `jump` on `ask:01MCBKEP00AF27SH36Z7R1YMBQ` at 0.017 s, 0.2999; `jump` on `ask:01MCBKGGK0MYVC1Z4PFPG8Q85H` at 0.017 s, 0.2999; `jump` on `ask:01MCBKJB60W8KQQYERE7QKXH5K` at 0.017 s, 0.2999; `jump` on `ask:01MCBKM5S08BX0Q7W6PAAZ9V33` at 0.017 s, 0.2999; `jump` on `ask:01MCBKP0C0326Y1A9RPQYVNGPG` at 0.017 s, 0.2999; `jump` on `ask:01MCBKQTZ0EDAQT02919ZW2SFR` at 0.017 s, 0.2999; `jump` on `ask:01MCBKSNJ0FM55WQBQPTSVJAPV` at 0.017 s, 0.2999; `jump` on `ask:01MCBKVG50GQC93ENP7EY121TD` at 0.017 s, 0.2999; `jump` on `ask:01MCBKXAR0Z44974EVGRASG9RG` at 0.017 s, 0.2999; `jump` on `ask:01MCBKZ5B04TEWTB5FFGVYNJJ9` at 0.017 s, 0.2999; `jump` on `ask:01MCBM0ZY0Q8HQF8XBV866MV02` at 0.017 s, 0.2999; `jump` on `ask:01MCBM2TH0NW7SS2F1197R3CFM` at 0.017 s, 0.2999; `jump` on `ask:01MCBM4N40Z3CSTTRFF8PNDT8E` at 0.017 s, 0.2999; `jump` on `needs-you-title` at 0.017 s, 0.2999; `jump` on `tab-group` at 0.017 s, 0.2999; `jump` on `tab-group-content` at 0.017 s, 0.2999; `jump` on `sidebar` at 0.017 s, 0.2999; `jump` on `session:01MCBH57D812FQ88XJ33AV9KCE` at 0.017 s, 0.2999; `jump` on `session:01MCBH58CGAQESGES1C4G0D6KF` at 0.017 s, 0.2999; `jump` on `session:01MCBH59BR567E65G5ZMQVD50Y` at 0.017 s, 0.2999; `jump` on `session:01MCBH5AB06WMYG6MC4XXAC1Y8` at 0.017 s, 0.2999; `jump` on `session:01MCBH5BA8VDDP75ES6BGN4S84` at 0.017 s, 0.2999; `jump` on `session:01MCBH5C9GCHP932NZK0RVQ19S` at 0.017 s, 0.2999; `jump` on `session:01MCBH5D8RGQHJD9XH63321Q3Q` at 0.017 s, 0.2999; `jump` on `sidebar-title` at 0.017 s, 0.2999 | `451dcd67c346` |
| session | FAIL | `jump` on `root` at 0.017 s, 0.2999; `jump` on `dock-area` at 0.017 s, 0.2999; `jump` on `dock-area-center` at 0.017 s, 0.2999; `jump` on `tab-group` at 0.017 s, 0.2999; `jump` on `tab-group-content` at 0.017 s, 0.2999; `jump` on `line` at 0.017 s, 0.2999; `jump` on `line-status` at 0.017 s, 0.2999; `jump` on `session` at 0.017 s, 0.2999; `jump` on `return-card` at 0.017 s, 0.2999; `jump` on `session-line-label` at 0.017 s, 0.2999; `jump` on `session-title` at 0.017 s, 0.2999; `jump` on `tab-group` at 0.017 s, 0.2999; `jump` on `tab-group-content` at 0.017 s, 0.2999; `jump` on `sidebar` at 0.017 s, 0.2999; `jump` on `session:01MCBH57D812FQ88XJ33AV9KCE` at 0.017 s, 0.2999; `jump` on `session:01MCBH58CGAQESGES1C4G0D6KF` at 0.017 s, 0.2999; `jump` on `session:01MCBH59BR567E65G5ZMQVD50Y` at 0.017 s, 0.2999; `jump` on `session:01MCBH5AB06WMYG6MC4XXAC1Y8` at 0.017 s, 0.2999; `jump` on `session:01MCBH5BA8VDDP75ES6BGN4S84` at 0.017 s, 0.2999; `jump` on `session:01MCBH5C9GCHP932NZK0RVQ19S` at 0.017 s, 0.2999; `jump` on `session:01MCBH5D8RGQHJD9XH63321Q3Q` at 0.017 s, 0.2999; `jump` on `sidebar-title` at 0.017 s, 0.2999 | `c6e80f77b32e` |
| project | FAIL | `jump` on `root` at 0.017 s, 0.2999; `jump` on `dock-area` at 0.017 s, 0.2999; `jump` on `dock-area-center` at 0.017 s, 0.2999; `jump` on `tab-group` at 0.017 s, 0.2999; `jump` on `tab-group-content` at 0.017 s, 0.2999; `jump` on `home` at 0.017 s, 0.2999; `jump` on `home-needs-you` at 0.017 s, 0.2999; `jump` on `home-title` at 0.017 s, 0.2999; `jump` on `line` at 0.017 s, 0.2999; `jump` on `line-status` at 0.017 s, 0.2999; `jump` on `tab-group` at 0.017 s, 0.2999; `jump` on `tab-group-content` at 0.017 s, 0.2999; `jump` on `sidebar` at 0.017 s, 0.2999; `jump` on `session:01MCBH57D812FQ88XJ33AV9KCE` at 0.017 s, 0.2999; `jump` on `session:01MCBH58CGAQESGES1C4G0D6KF` at 0.017 s, 0.2999; `jump` on `session:01MCBH59BR567E65G5ZMQVD50Y` at 0.017 s, 0.2999; `jump` on `session:01MCBH5AB06WMYG6MC4XXAC1Y8` at 0.017 s, 0.2999; `jump` on `session:01MCBH5BA8VDDP75ES6BGN4S84` at 0.017 s, 0.2999; `jump` on `session:01MCBH5C9GCHP932NZK0RVQ19S` at 0.017 s, 0.2999; `jump` on `session:01MCBH5D8RGQHJD9XH63321Q3Q` at 0.017 s, 0.2999; `jump` on `sidebar-title` at 0.017 s, 0.2999 | `aa97e2bf5b2c` |
