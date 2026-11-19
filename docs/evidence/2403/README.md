# #2403: the app speaks your language

## Pictures (from the replica, not yet AC7's)

AC7 asks for the real app's pictures, taken by `tests/acceptance/2403/shown.test.ts` with Screen Recording. The Mac this
was built on grants that permission to no process the check runs under, so that file reads BLOCKED here and AC7's taste
call is still owed. Until it runs, these are the same three states drawn by the replica (`deep-drive`), which draws the
real app's tree: its default fixture, the reference window (1512 × 982 pt, at 2×), TZ=UTC, light, after one second of its
clock, in `locale: en-US` and `locale: zh-Hans`.

| State | en-US | zh-Hans |
|---|---|---|
| Needs you with a question card | [needs-you-card-en-US.png](needs-you-card-en-US.png) | [needs-you-card-zh-Hans.png](needs-you-card-zh-Hans.png) |
| A session's page | [session-page-en-US.png](session-page-en-US.png) | [session-page-zh-Hans.png](session-page-zh-Hans.png) |
| The empty state | [empty-state-en-US.png](empty-state-en-US.png) | [empty-state-zh-Hans.png](empty-state-zh-Hans.png) |

SHA-256:

```
1debd3c6b7dd0e0eda207efdcaaded484ac98cecde6d7c19795fd7e4f967d9c0  needs-you-card-en-US.png
2df71b2d58c81bb0854324f3ee72c1c6c2aee2fee5639c24c002f569e6ffe065  needs-you-card-zh-Hans.png
e4a2cd7322eebf267e16c347defb1bb24f749e9fd80afad95c0761374bb2753d  session-page-en-US.png
de8d00b13cb36502accefc280bffe37e334c9407c761416d3afb1ef22b8d4d8e  session-page-zh-Hans.png
d04c2bb341849398ae95ea8ed5a5920148c87f6eaa20771607b4011cc7c3188a  empty-state-en-US.png
09588add8cf250510c2fa2ab167b07a00492d28f9b2cf55cbbadb6c2ff68a30f  empty-state-zh-Hans.png
```

The fixture's asks, options and task titles are an agent's words and stay in English in both. In zh-Hans every word the
app draws of its own is Chinese: the heading 待你处理, the kinds (批准, 你的步骤, 外观, 问题, 选一个, 怎样算完成), the
row states (已折叠, 保留中), the card's fields and labels (公开：否, 推荐, 默认：否 · 13:00 生效, 拒绝), the session page's
lines and the chart's caption (有截止时间的请求, drawn from the look's Noto Sans SC fallback), and the empty state
(新任务, 没有待你处理的事, 发送).

## Runs

The blind suite `tests/acceptance/2403` on the tree merged with main (0ee14dd43 and the fixes after it), each file once
when its code was done, `--no-file-parallelism --testTimeout=600000`, loads 20 to 110 on 18 cores:

- `lint.test.ts` AC2 and AC4's planted sentence, `release.test.ts` AC6, `counts.test.ts` AC4, `asks.test.ts` AC5: pass
  (the first full run, 537 s).
- `words.test.ts` AC1 (both tests) and `layout.test.ts` AC3 (both tests): pass on the rerun after the hub's sentences and
  the page title's ellipsis (200 s). Their first run failed: the hub's sentences were still English in zh-Hans, and a
  long session title ran past its frame at 360 pt in both languages.
- `shown.test.ts` AC7: BLOCKED, no Screen Recording for the process running it.
