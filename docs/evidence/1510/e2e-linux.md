# #1510 by hand on Linux, 2026-11-07

Branch head 4a42981a. A real hub (`deep hub run`) in a temp HOME. Its record was seeded before it started, through the real record and asks core, as tests/acceptance/1510 does. It holds two authority asks, quoting `git push --force\x1b[2K\rgit status` and `git push --force\ngit status`, each with a one-step plan running its call; taste asks holding U+202E, Chinese and emoji; and a finished turn whose shell call ran the escape command. Then the built CLI: `env -i PATH=… HOME=<temp> LC_ALL=C.UTF-8 node packages/cli/dist/main.js inbox` and `… status`.

## deep inbox (exit 0)
```
ask:01M6WNMVGENXB0DSCFXQY17BTR  authority  S1510-esc  1m  shown  Run `git push --force\x1b[2K\rgit status` in shop?  [approve | decline]
    plan 25d40d57531b: 1 step, 0 can't be undone
    1. git push --force\x1b[2K\rgit status  changes origin/main  undo: Revert it  cost $0.00
ask:01M6WNMVGR9KRE4JSNNSKBTY7B  authority  S1510-newline  1m  shown  Run `git push --force\ngit status` in shop?  [approve | decline]
    plan fb5b1243ab20: 1 step, 0 can't be undone
    1. git push --force\ngit status  changes origin/main  undo: Revert it  cost $0.00
ask:01M6WNMVH2V7R7TG0TVZ2DVR1N  taste  S1510-rlo  1m  shown  Open the attachment invoice\u{202e}txt.exe for the review?  [blue | green]
ask:01M6WNMVHCKQ8MXAE0NEVZMKGV  taste  S1510-chinese  1m  shown  结账页面的标题用哪种颜色？  [blue | green]
ask:01M6WNMVHPY5FYN5HZBAXJ09M4  taste  S1510-emoji  1m  shown  Ship the new header? 🚀 ✅ 👍🏽 ❤️ 👨‍👩‍👧  [blue | green]
```

## deep status (exit 0)
```
Reading the hub at unix:<temp>/.deepbuild/hub.sock
6 sessions: 5 need you, 1 finished
shop
  S1510-es  needs you  claude-code  an ask open for 1m
  S1510-ne  needs you  claude-code  an ask open for 1m
  S1510-rl  needs you  claude-code  an ask open for 1m
  S1510-ch  needs you  claude-code  an ask open for 1m
  S1510-em  needs you  claude-code  an ask open for 1m
Finished, with what its last turn did:
shop
  S1510sta  finished   claude-code  its turn stopped 1m ago
      shell git push --force\x1b[2K\rgit status  ok
```

## Bytes

Control bytes other than `\n` (C0, DEL, and C1 as UTF-8 `c2 80`–`c2 9f`), counted with `grep -caP`: inbox 0, status 0.

The escape ask's row, `od -c`:
```
0000060   -   e   s   c           1   m           s   h   o   w   n    
0000100       R   u   n       `   g   i   t       p   u   s   h       -
0000120   -   f   o   r   c   e   \   x   1   b   [   2   K   \   r   g
0000140   i   t       s   t   a   t   u   s   `       i   n       s   h
0000160   o   p   ?           [   a   p   p   r   o   v   e       |    
```
The emoji row keeps its bytes (ZWJ `342 200 215`, VS16 `357 270 217`):
```
0000060   j   i           1   m           s   h   o   w   n           S
0000100   h   i   p       t   h   e       n   e   w       h   e   a   d
0000120   e   r   ?     360 237 232 200     342 234 205     360 237 221
0000140 215 360 237 217 275     342 235 244 357 270 217     360 237 221
0000160 250 342 200 215 360 237 221 251 342 200 215 360 237 221 247    
0000200       [   b   l   u   e       |       g   r   e   e   n   ]  \n
```

## The record

Read back through the hub socket's `events.read` before the hub stopped, each text printed with Python's `ascii()`. So `\x1b`, `\r`, `\n` and `‮` here stand for the raw characters the record holds, not for marks:
```
ask.created 'Run `git push --force\x1b[2K\rgit status` in shop?'
plan.proposed 'git push --force\x1b[2K\rgit status'
ask.created 'Run `git push --force\ngit status` in shop?'
plan.proposed 'git push --force\ngit status'
ask.created 'Open the attachment invoice\u202etxt.exe for the review?'
ask.created '\u7ed3\u8d26\u9875\u9762\u7684\u6807\u9898\u7528\u54ea\u79cd\u989c\u8272\uff1f'
ask.created 'Ship the new header? \U0001f680 \u2705 \U0001f44d\U0001f3fd \u2764\ufe0f \U0001f468\u200d\U0001f469\u200d\U0001f467'
tool.before 'git push --force\x1b[2K\rgit status'
```
