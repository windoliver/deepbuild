import json, os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
B = chr(92)


def call(command, extra=None):
    head = json.dumps({"session_id": "e2e", "cwd": "/tmp/e2e-2042/w", "hook_event_name": "PreToolUse",
                       "tool_name": "Bash"})[:-1]
    members = "".join(f",{json.dumps(k)}:{v}" for k, v in (extra or {}).items())
    return f'{head},"tool_input":{{"command":{json.dumps(command)}{members}}},"tool_use_id":"toolu_e2e"}}'.encode()


nested = call("git push origin main", {"nested": "[" * 300 + "1" + "]" * 300})
big = call("git push origin main", {"pad": json.dumps("a" * (2 << 20))})
bad_utf8 = call("git push origin main", {"x": '"-"'}).replace(b'"-"', b'"\xff"')
lone = '"half ' + B + 'ud800 a pair"'
cases = {
    "01-nested-300": nested,
    "02-cut-40-bytes": nested[:40],
    "03-empty": b"",
    "04-not-json": b"not json {",
    "05-not-utf8": bad_utf8,
    "06-2MiB-cut-short": big[: 1 << 20],
    "07-number-1e999": call("git push origin main", {"n": "1e999"}),
    "08-valid-ls": call("ls"),
    "09-lone-surrogate-ls": call("ls", {"x": lone}),
    "10-lone-surrogate-push": call("git push origin main", {"x": lone}),
    "11-valid-push": call("git push origin main"),
}
for name, data in cases.items():
    open(os.path.join(out, name), "wb").write(data)
