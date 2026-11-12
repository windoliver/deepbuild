# The #1468 e2e: each real binary gets a document holding a 1,000,000-paren string, then, in the
# same process, the same document with one paren, so a reply to the second shows the process stayed up.
# The pack rule's second document is a second pack, `shallowrule`, as one id installs once.
# Usage: python3 -I e2e.py <bin_dir>
import json, os, re, subprocess, sys, tempfile
bin_dir = sys.argv[1]
N = 1_000_000
def wrapped(inner, n): return "(" * n + inner + ")" * n
def short(v):
    # Long values are cut here, by this script, so each reply fits on a screen.
    if isinstance(v, str):
        if re.fullmatch(r"[0-9a-f]{64}", v): return v[:12] + "…"
        return v if len(v) <= 80 else f"{v[:40]}…[a {len(v):,}-char value, cut here by e2e.py]"
    if isinstance(v, list): return [short(x) for x in v[:6]] + ([f"…[{len(v) - 6:,} more, cut here by e2e.py]"] if len(v) > 6 else [])
    if isinstance(v, dict): return {k: "[cut here by e2e.py]" if k in ("frames", "texts", "glyphs") else short(x) for k, x in v.items()}
    return v
def run(name, args, lines):
    print(f"== {name}")
    path = os.path.join(bin_dir, args[0])
    if not os.path.exists(path):
        print(f"BLOCKED: {args[0]} isn't built here"); return
    p = subprocess.run([path] + args[1:], input="".join(l + "\n" for l in lines).encode(), capture_output=True, timeout=600)
    replies = p.stdout.decode().splitlines()
    for i, what in enumerate(w for w, _ in lines_of[name]):
        if i < len(replies):
            try: text = json.dumps(short(json.loads(replies[i])), ensure_ascii=False)
            except ValueError: text = replies[i][:600] + ("…[cut here by e2e.py]" if len(replies[i]) > 600 else "")
            print(f"reply {i + 1} ({what}): {text}")
        else:
            print(f"reply {i + 1} ({what}): none")
    for l in (p.stderr.decode().strip().splitlines()[-2:] if p.returncode else []): print("stderr (its last 2 lines):", l)
    print(f"exit {p.returncode}" + (f", died by signal {-p.returncode}" if p.returncode < 0 else ""))
    return p.returncode
lines_of = {}
codes = []
def case(name, args, make):
    lines_of[name] = [(f"{n:,} paren" + ("s" if n > 1 else ""), make(n)) for n in (N, 1)]
    codes.append(run(name, args, [l for _, l in lines_of[name]]))
# Driver
dot = {"id": "dot", "kind": "rect@1", "layer": "main", "name": "Rect dot", "order": "adot",
       "params": {"box": [0, 0, 20, 20], "paint": {"fill": {"role": "ink"}}}, "at": {"pos": [0, 0, 0]}}
def driver(n):
    doc = {"format": 1, "id": "driver-1468", "profile": "film", "title": "#1468 driver", "description": "One driver.",
           "size": [640, 360], "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
           "transport": {"span": "4s"}, "items": {"dot": dot},
           "drivers": {"deep": {"target": "items/dot/at/pos/1", "expr": wrapped("1", n), "vars": {}}}}
    return json.dumps({"doc": doc, "times": [0]})
case("driver: deep-motion eval", ["deep-motion", "eval"], driver)
# Field
png = os.path.join(tempfile.mkdtemp(), "frame.png")
def field(n):
    text = {"id": "words", "kind": "text@1", "layer": "main", "name": "Words", "order": "a1",
            "params": {"text": "ABCDE", "animators": [{"units": "grapheme", "props": {"y": 1},
                       "selectors": [{"field": {"expr": wrapped("i", n)}}]}]}, "at": {"pos": [0, 0, 0]}}
    fdoc = {"format": 1, "id": "field-1468", "profile": "film", "transport": {"span": "1s", "frame_rate": "60/1"}, "title": "#1468 field", "description": "One text animator.",
            "size": [640, 360], "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}}, "items": {"words": text}}
    return json.dumps({"out": png, "doc": fdoc, "look": "clean", "t": 0})
case("field: deep-canvas-render raster", ["deep-canvas-render", "raster"], field)
# Pack rule: one scenario per line, each installing a pack whose rule holds the string.
def pack(n):
    name = "deeprule" if n == N else "shallowrule"
    manifest = {"name": name, "version": "1.0.0", "license": "MIT", "description": "One kind whose rule holds the string.",
        "requires": {"core": ">=0.0.0"},
        "recipes": {f"{name}.probe@1": {"id": f"{name}.probe", "version": "1.0", "title": "Deep rule probe", "license": "MIT",
            "author": "the #1468 e2e", "description": "A square whose rule reads x.",
            "inputs": {"x": {"type": "number", "default": 1, "min": 0, "max": 2, "about": "what the rule reads"}},
            "steps": {"dot": {"op": "mark", "kind": "rect@1", "params": {"box": [0, 0, 4, 4], "paint": {"fill": {"role": "ink"}}}}},
            "outputs": {"parts": ["dot"]},
            "rules": [{"code": f"{name}.holds", "expr": wrapped("x", n) + " >= 1", "at": "rest", "fix": "set x to 1 or more"}],
            "twins": [{"params": {"x": 0}, "expect": f"{name}.holds"}]}}}
    d = tempfile.mkdtemp()
    open(os.path.join(d, "pack.json"), "w").write(json.dumps(manifest))
    return json.dumps({"evidence": tempfile.mkdtemp(), "calls": [{"call": "install_pack", "id": f"test/{name}", "dir": d}]})
case("pack rule: deep-show run install_pack", ["deep-show", "run"], pack)
# Exits 1 when a binary failed and 2 when one wasn't built, so neither run reads as a pass.
sys.exit(1 if any(c not in (0, None) for c in codes) else 2 if None in codes else 0)
