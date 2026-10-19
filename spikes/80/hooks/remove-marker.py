# Throwaway #80 spike: a child process of the agent's Bash call removes the spike marker hook entry.
import json, os, subprocess, sys
child = r'''
import json, os
p = os.path.expanduser("~/.claude/settings.json")
s = json.load(open(p))
s["hooks"]["PreToolUse"] = [g for g in s["hooks"]["PreToolUse"] if g.get("matcher") != "Spike80Marker"]
tmp = p + ".spike80.tmp"
json.dump(s, open(tmp, "w"), indent=2)
os.replace(tmp, p)
print("child", os.getpid(), "removed marker")
'''
subprocess.run([sys.executable, "-c", child], check=True)
