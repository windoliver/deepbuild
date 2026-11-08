# The #1468 e2e: a document holding a 1,000,000-paren string through each real binary.
import json, os, subprocess, sys, tempfile
bin_dir, mode = sys.argv[1], sys.argv[2]  # mode: deep | shallow
N = 1_000_000 if mode == "deep" else 1
def wrapped(inner): return "(" * N + inner + ")" * N
def run(args, line):
    p = subprocess.run([os.path.join(bin_dir, args[0])] + args[1:], input=line.encode(), capture_output=True, timeout=600)
    out = p.stdout.decode()
    try:
        def short(v):
            if isinstance(v, str): return v if len(v) <= 80 else f"{v[:40]}…({len(v):,} chars)"
            if isinstance(v, list): return [short(x) for x in v[:6]]
            if isinstance(v, dict): return {k: short(x) for k, x in v.items() if k not in ("frames", "texts", "glyphs")}
            return v
        out = json.dumps(short(json.loads(out.splitlines()[0])), ensure_ascii=False)
    except Exception:
        out = out[:600]
    err = p.stderr.decode().strip().splitlines()[-2:] if p.returncode else []
    sig = -p.returncode if p.returncode < 0 else None
    return {"exit": p.returncode, "signal": sig, "stdout": out, "stderr_tail": err}
def show(name, r):
    print(f"== {name} ({mode}, {N:,} parens): exit {r['exit']}" + (f", died by signal {r['signal']}" if r['signal'] else ""))
    if r["stdout"]: print("stdout:", r["stdout"].strip()[:900])
    for l in r["stderr_tail"]: print("stderr:", l)
# Driver
dot = {"id": "dot", "kind": "rect@1", "layer": "main", "name": "Rect dot", "order": "adot",
       "params": {"box": [0, 0, 20, 20], "paint": {"fill": {"role": "ink"}}}, "at": {"pos": [0, 0, 0]}}
doc = {"format": 1, "id": "driver-1468", "profile": "film", "title": "#1468 driver", "description": "One driver.",
       "size": [640, 360], "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
       "transport": {"span": "4s"}, "items": {"dot": dot},
       "drivers": {"deep": {"target": "items/dot/at/pos/1", "expr": wrapped("1"), "vars": {}}}}
show("driver: deep-motion eval", run(["deep-motion", "eval"], json.dumps({"doc": doc, "times": [0]}) + "\n"))
# Field
text = {"id": "words", "kind": "text@1", "layer": "main", "name": "Words", "order": "a1",
        "params": {"text": "ABCDE", "animators": [{"units": "grapheme", "props": {"y": 1},
                   "selectors": [{"field": {"expr": wrapped("i")}}]}]}, "at": {"pos": [0, 0, 0]}}
fdoc = {"format": 1, "id": "field-1468", "profile": "film", "transport": {"span": "1s", "frame_rate": "60/1"}, "title": "#1468 field", "description": "One text animator.",
        "size": [640, 360], "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}}, "items": {"words": text}}
png = os.path.join(tempfile.mkdtemp(), "frame.png")
show("field: deep-canvas-render raster", run(["deep-canvas-render", "raster"], json.dumps({"out": png, "doc": fdoc, "look": "clean", "t": 0}) + "\n"))
# Pack rule
rule = wrapped("x") + " >= 1"
manifest = {"name": "deeprule", "version": "1.0.0", "license": "MIT", "description": "One kind whose rule holds the string.",
    "requires": {"core": ">=0.0.0"},
    "recipes": {"deeprule.probe@1": {"id": "deeprule.probe", "version": "1.0", "title": "Deep rule probe", "license": "MIT",
        "author": "the #1468 e2e", "description": "A square whose rule reads x.",
        "inputs": {"x": {"type": "number", "default": 1, "min": 0, "max": 2, "about": "what the rule reads"}},
        "steps": {"dot": {"op": "mark", "kind": "rect@1", "params": {"box": [0, 0, 4, 4], "paint": {"fill": {"role": "ink"}}}}},
        "outputs": {"parts": ["dot"]},
        "rules": [{"code": "deeprule.holds", "expr": rule, "at": "rest", "fix": "set x to 1 or more"}],
        "twins": [{"params": {"x": 0}, "expect": "deeprule.holds"}]}}}
d = tempfile.mkdtemp(); ev = tempfile.mkdtemp()
open(os.path.join(d, "pack.json"), "w").write(json.dumps(manifest))
sc = {"evidence": ev, "calls": [{"call": "install_pack", "id": "test/deeprule", "dir": d}]}
show("pack rule: deep-show run install_pack", run(["deep-show", "run"], json.dumps(sc) + "\n"))
