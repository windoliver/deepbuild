#!/usr/bin/env python3
# The live proof for #1022: the real Codex TUI (fake model, no spend) with DeepBuild's own hooks from `deep setup`,
# a real hub in a scratch home, a prompt, then /compact, then quit. Prints the session's record.
import os, pty, sys, time, select, json, subprocess, sqlite3, signal, fcntl, termios, struct, tempfile, shutil

CODEX = sys.argv[1]; REPO = sys.argv[2]
NODE = subprocess.check_output(['which', 'node']).decode().strip()
T = os.path.realpath(tempfile.mkdtemp(prefix='dh1022-', dir='/tmp'))  # a socket path must fit in 104 bytes
H = f'{T}/h'; W = f'{T}/w'; BIN = f'{T}/bin'
for d in (f'{H}/.codex', f'{H}/.claude', W, BIN, f'{T}/tmp'): os.makedirs(d, exist_ok=True)
os.symlink(CODEX, f'{BIN}/codex')
for n in ('launchctl', 'systemctl', 'claude'):
    open(f'{BIN}/{n}', 'w').write('#!/bin/sh\nexit 0\n'); os.chmod(f'{BIN}/{n}', 0o755)
open(f'{T}/confirm', 'w').write('confirmed\n')
subprocess.run('git init -q && echo x > a.txt && git add -A && git -c user.email=a@b -c user.name=a commit -qm init', shell=True, cwd=W, check=True)
env = {'HOME': H, 'PATH': f'{BIN}:{os.path.dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin', 'TMPDIR': f'{T}/tmp', 'SHELL': '/bin/sh', 'LANG': 'en_US.UTF-8',
       'XDG_CONFIG_HOME': f'{H}/.config', 'XDG_CACHE_HOME': f'{H}/.cache', 'DEEP_HUB_TEST_CONFIRM': f'{T}/confirm'}
CLI = f'{REPO}/packages/cli/dist/main.js'
hub = subprocess.Popen([NODE, CLI, 'hub', 'run'], cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=open(f'{T}/hub.err', 'w', buffering=1), start_new_session=True)
print('hub ready:', hub.stdout.readline().decode().strip()[:120])
r = subprocess.run([NODE, CLI, 'setup'], cwd=REPO, env=env, capture_output=True, text=True)
print('setup exit', r.returncode, r.stderr[-300:])
fake = subprocess.Popen([NODE, f'{REPO}/spikes/1330/fake-openai.mjs'], stdout=subprocess.PIPE, env={**env, 'FAKE_LOG': f'{T}/model.log'}, start_new_session=True)
port = fake.stdout.readline().decode().strip()
cfgp = f'{H}/.codex/config.toml'
cfg = open(cfgp).read() if os.path.exists(cfgp) else ''
open(cfgp, 'w').write(f'model_provider = "fake"\nmodel = "gpt-fake"\n' + cfg + f'''
[features]
hooks = true
codex_hooks = true
[model_providers.fake]
name = "fake"
base_url = "http://127.0.0.1:{port}/v1"
wire_api = "responses"
env_key = "FAKE_KEY"
[projects."{W}"]
trust_level = "trusted"
''')
cenv = {**env, 'CODEX_HOME': f'{H}/.codex', 'FAKE_KEY': 'sk-fake', 'TERM': 'xterm-256color'}
print(subprocess.run([NODE, f'{REPO}/spikes/1330/trust.mjs', CODEX, W, cfgp], cwd=W, env=cenv, capture_output=True, text=True).stdout.strip())

pid, fd = pty.fork()
if pid == 0:
    os.chdir(W); os.execve(CODEX, [CODEX], cenv)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
def pump(secs):
    end = time.time() + secs
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.1)
        if fd in r:
            try: d = os.read(fd, 65536)
            except OSError: return
            if b'\x1b[6n' in d: os.write(fd, b'\x1b[1;1R')
            if b'\x1b[c' in d or b'\x1b[0c' in d: os.write(fd, b'\x1b[?62;c')
            if b'\x1b]10;?' in d: os.write(fd, b'\x1b]10;rgb:ffff/ffff/ffff\x1b\\')
            if b'\x1b]11;?' in d: os.write(fd, b'\x1b]11;rgb:0000/0000/0000\x1b\\')
def typ(text):
    for ch in text: os.write(fd, ch.encode()); pump(0.05)
def requests():
    return len(open(f'{T}/model.log').read().splitlines()) if os.path.exists(f'{T}/model.log') else 0
def until(cond, secs):
    end = time.time() + secs
    while time.time() < end and not cond(): pump(0.3)
pump(10)
typ('say hi'); pump(1); os.write(fd, b'\r')
until(lambda: requests() >= 1, 30); pump(6)
print('after prompt, model requests:', requests())
typ('/compact'); pump(2); os.write(fd, b'\r')
until(lambda: requests() >= 2, 30); pump(8)
print('after /compact, model requests:', requests())
typ('/quit'); pump(1); os.write(fd, b'\r'); pump(5)
try: os.kill(pid, signal.SIGKILL)
except Exception: pass
time.sleep(45)  # the core queue drains, and the spool replay runs every 2 s
for p in (hub, fake): p.terminate()
hub.wait(30); fake.wait(5)
db = sqlite3.connect(f'{H}/.deepbuild/ledger.db')
rows = db.execute("SELECT log_pos, kind, json_extract(data,'$.reading'), json_extract(data,'$.text'), json_extract(data,'$.from') FROM events WHERE session_id IS NOT NULL AND kind IN ('user.ask','session.reading','agent.stop') ORDER BY log_pos").fetchall()
for row in rows: print(row)
print('PreCompact readings:', sum(1 for r in rows if r[1] == 'session.reading' and str(r[2]).startswith('PreCompact')))
print('PostCompact readings:', sum(1 for r in rows if r[1] == 'session.reading' and str(r[2]).startswith('PostCompact')))
print('user.asks:', [(r[3], r[4]) for r in rows if r[1] == 'user.ask'])
spool = f'{H}/.deepbuild/spool'
print('spooled lines:', sum(len(open(os.path.join(spool, f)).read().splitlines()) for f in os.listdir(spool)) if os.path.isdir(spool) else 0)
print('T =', T)
for row in db.execute("SELECT log_pos, kind, session_id, substr(data,1,160) FROM events WHERE session_id IS NOT NULL ORDER BY log_pos"): print(row)
if '--keep' not in sys.argv: subprocess.run(['rm','-rf',T])
