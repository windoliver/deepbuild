# #2563 e2e by hand (2026-11-20, macOS, branch claude/fix-2563-inbox-option-ids-a4b643)

Real hub (`deep hub run`, PID 13097, fresh HOME /tmp/e2e2563, OS confirm stubbed by DEEP_HUB_TEST_CONFIRM as the
suites do). Asks raised by an agent session's real `deep mcp` → `deep_ask` (three sessions, groups A/B/C).
Stopped afterwards by Ctrl-C in its own tab (PID gone), home removed.

## Raising (deep mcp → deep_ask)

```
raised "-fast": yes
raised "esc\u001bkey": yes
raised "zero​width": yes
raised "it's": yes
raised "title case": yes
raised "red, green": yes
raised "wide (padded)": yes
raised "back\\slash": yes
NUL option: {"content":[{"type":"text","text":"{\"code\":\"enum\",\"retryable\":false,\"remediation\":\"option \\\"nul\\\\u0000end\\\" holds a NUL, which no command line carries, so deep inbox answer could never choose it\",\"path\":\"/params/option\",\"actual\":\"nul\\u0000end\",\"evidence\":[]}"}],"isError":true}
raised "a'b!x\u001b": yes
raised "x!y": yes
```

## deep inbox

```
Which build mode for the release?  choice  no repo  c9cb2372-…  4s  If you don't answer: Plain, on Mon 23 Nov at 02:41  ask:01M7W8QBD30XWNMFE9S3M189QJ
    answer with -- -fast (Fast build), plain
Which key closes the dialog?  …  ask:01M7W8QBHFTHD710147YXZTB4C
    answer with $'esc\033key' (Escape key), plain
Which joiner goes between the words?  …  ask:01M7W8QBR9BW1CW7PPNQ7ENMM7
    answer with $'zero\342\200\213width' (No visible gap), plain
Whose style guide?  …  ask:01M7W8QBY7N5KDNAV9A706SB9F
    answer with 'it'\''s' (It's ours), plain
How are the headings cased?  …  ask:01M7W8QCVJG19Y6TR9DKY0E6GR
    answer with 'title case', plain
Which colours does the chart use?  …  ask:01M7W8QD1JRCDF17FHZJ22CV0W
    answer with 'red, green' (Red and green), plain
Which margin goes around the table?  …  ask:01M7W8QD7JVMF7TEQMCRR9HZY3
    answer with 'wide (padded)' (Wide with padding), plain
Which path separator?  …  ask:01M7W8QDEC99B34YJSGVG1B2KN
    answer with 'back\slash' (Backslash), plain
Which shout in the banner?  …  ask:01M7W8QERFF9KT0EE5AAMBFH5F
    answer with $'a\047b!x\033' (Quote, bang and ESC), plain
Which name?  …  ask:01M7W8QET6J073QJX62F07G7JC
    answer with 'x!y' (Bang), plain
10 asks need you
```

## deep inbox answer, each form typed as printed

In the user's interactive bash 3.2 (Terminal panel):

```
$ deep inbox answer ask:01M7W8QBD30XWNMFE9S3M189QJ -- -fast; deep inbox answer ask:01M7W8QBY7N5KDNAV9A706SB9F 'it'\''s'; deep inbox answer ask:01M7W8QCVJG19Y6TR9DKY0E6GR 'title case'; deep inbox answer ask:01M7W8QD1JRCDF17FHZJ22CV0W 'red, green'; deep inbox answer ask:01M7W8QD7JVMF7TEQMCRR9HZY3 'wide (padded)'; deep inbox answer ask:01M7W8QDEC99B34YJSGVG1B2KN 'back\slash'
ask:01M7W8QBD30XWNMFE9S3M189QJ answered -fast, saved as a decision for session:c9cb2372952e439fba45bf826ff2bb58
ask:01M7W8QBY7N5KDNAV9A706SB9F answered it's, saved as a decision for session:c9cb2372952e439fba45bf826ff2bb58
ask:01M7W8QCVJG19Y6TR9DKY0E6GR answered title case, saved as a decision for session:87dde6dc380f4e5ba1c44fe32e7c8527
ask:01M7W8QD1JRCDF17FHZJ22CV0W answered red, green, saved as a decision for session:87dde6dc380f4e5ba1c44fe32e7c8527
ask:01M7W8QD7JVMF7TEQMCRR9HZY3 answered wide (padded), saved as a decision for session:87dde6dc380f4e5ba1c44fe32e7c8527
ask:01M7W8QDEC99B34YJSGVG1B2KN answered back\slash, saved as a decision for session:87dde6dc380f4e5ba1c44fe32e7c8527
```

The Terminal panel tool refuses lines with `!` or `$'…'` numeric escapes, so the last four went to an interactive
`/bin/bash --norc --noprofile -i` (bash 3.2, histexpand on) fed the lines verbatim:

```
bash-3.2$ set -o | grep -e histexpand -e history
histexpand     	on
history        	on
bash-3.2$ deep inbox answer ask:01M7W8QBHFTHD710147YXZTB4C $'esc\033key'
ask:01M7W8QBHFTHD710147YXZTB4C answered esc\x1bkey, saved as a decision for session:c9cb2372952e439fba45bf826ff2bb58
bash-3.2$ deep inbox answer ask:01M7W8QBR9BW1CW7PPNQ7ENMM7 $'zero\342\200\213width'
ask:01M7W8QBR9BW1CW7PPNQ7ENMM7 answered zero\u{200b}width, saved as a decision for session:c9cb2372952e439fba45bf826ff2bb58
bash-3.2$ deep inbox answer ask:01M7W8QERFF9KT0EE5AAMBFH5F $'a\047b!x\033'
ask:01M7W8QERFF9KT0EE5AAMBFH5F answered a'b!x\x1b, saved as a decision for session:e04f4b187bc94e6ab911da4b2a6dc9c9
bash-3.2$ deep inbox answer ask:01M7W8QET6J073QJX62F07G7JC 'x!y'
ask:01M7W8QET6J073QJX62F07G7JC answered x!y, saved as a decision for session:e04f4b187bc94e6ab911da4b2a6dc9c9
bash-3.2$ deep inbox
Nothing needs you
```

## The record (events.read on a cli connection)

```
ask.answered  ask:01M7W8QBD30XWNMFE9S3M189QJ  writer=core  answer="-fast"  (Which build mode for the release?)
ask.answered  ask:01M7W8QBY7N5KDNAV9A706SB9F  writer=core  answer="it's"  (Whose style guide?)
ask.answered  ask:01M7W8QCVJG19Y6TR9DKY0E6GR  writer=core  answer="title case"  (How are the headings cased?)
ask.answered  ask:01M7W8QD1JRCDF17FHZJ22CV0W  writer=core  answer="red, green"  (Which colours does the chart use?)
ask.answered  ask:01M7W8QD7JVMF7TEQMCRR9HZY3  writer=core  answer="wide (padded)"  (Which margin goes around the table?)
ask.answered  ask:01M7W8QDEC99B34YJSGVG1B2KN  writer=core  answer="back\\slash"  (Which path separator?)
ask.answered  ask:01M7W8QBHFTHD710147YXZTB4C  writer=core  answer="esc\u001bkey"  (Which key closes the dialog?)
ask.answered  ask:01M7W8QBR9BW1CW7PPNQ7ENMM7  writer=core  answer="zero​width"  (Which joiner goes between the words?)
ask.answered  ask:01M7W8QERFF9KT0EE5AAMBFH5F  writer=core  answer="a'b!x\u001b"  (Which shout in the banner?)
ask.answered  ask:01M7W8QET6J073QJX62F07G7JC  writer=core  answer="x!y"  (Which name?)
```

No error anywhere in the run.
