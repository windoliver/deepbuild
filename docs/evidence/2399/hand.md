# By hand: #1106's sample stack through the supervisor, requests to the run's filter port

The stack is `tests/acceptance/1106`'s world (`upWorld`): a hub on a temp folder, `deep env up` in a worktree, the app
sandboxed by the supervisor with two credentials that have `hosts:`, so the run has an egress filter. The requests
come from outside the run, to the port in the app's `HTTPS_PROXY`. After each step the run's `sandbox.denied` events
are read from the record (`events.read`), three seconds after the last answer.

## Proxy-form requests: `GET http://<name>/ HTTP/1.1` with `Host: <name>`

Here the name is in the request line and in `Host`; the filter reads the request line first (`egress.ts`), so these
differ in both. A plain request is recorded with the port 443 added to its name, as at the base.

Merge base (`72fe11a11`, the supervisor's source put back and rebuilt):
```
run run:01M7E6AJFWC9N4FSDJA458N7NJ, sandboxed stack up, filter on 127.0.0.1:42515
50 identical plain requests (Host: manual-same.invalid): answers {"403":50}; sandbox.denied gained 50
50 more of the same, in parallel: answers {"403":50}; sandbox.denied gained 50
200 plain requests differing only in Host: answers {"403":200}; sandbox.denied gained 200
the same 200 again: answers {"403":200}; sandbox.denied gained 200
50 tunnels to manual-tunnel.invalid:443: answers {"403":50}; sandbox.denied gained 50
1 tunnel to manual-tunnel-2.invalid:443: answers {"403":1}; sandbox.denied gained 1
1 tunnel to the allowed shop host: answers {"200":1}; sandbox.denied gained 0
total sandbox.denied for the run: 551
```

Branch:
```
run run:01M7E694B8RWVX6GPGQWKYYAV2, sandboxed stack up, filter on 127.0.0.1:43329
50 identical plain requests (Host: manual-same.invalid): answers {"403":50}; sandbox.denied gained 1 ["egress-plain-http manual-same.invalid:443"]
50 more of the same, in parallel: answers {"403":50}; sandbox.denied gained 0 []
200 plain requests differing only in Host: answers {"403":200}; sandbox.denied gained 200
the same 200 again: answers {"403":200}; sandbox.denied gained 0 []
50 tunnels to manual-tunnel.invalid:443: answers {"403":50}; sandbox.denied gained 1 ["egress-host manual-tunnel.invalid:443"]
1 tunnel to manual-tunnel-2.invalid:443: answers {"403":1}; sandbox.denied gained 1 ["egress-host manual-tunnel-2.invalid:443"]
1 tunnel to the allowed shop host: answers {"200":1}; sandbox.denied gained 0 []
total sandbox.denied for the run: 203
```

## Origin-form requests: `GET / HTTP/1.1`, differing only in `Host`

Branch only: the merge base was not rebuilt a second time, since a queued `affected.mjs` run reads this worktree.
The issue gives the base's reading for this form: 200 events for 200 requests.

```
run run:01M7EFAQH0ZW5QX8BVZQ0KGRDM, filter on 127.0.0.1:39255; each request is "GET / HTTP/1.1" with only Host set
50 identical (Host: only-host.invalid): answers {"403":50}; sandbox.denied gained 1; first ["egress-plain-http only-host.invalid"]
200 differing only in Host (only-host-<i>.invalid): answers {"403":200}; sandbox.denied gained 200; first ["egress-plain-http only-host-0.invalid","egress-plain-http only-host-1.invalid"]
the same 200 again: answers {"403":200}; sandbox.denied gained 0; first []
total sandbox.denied for the run: 201
```
