# The command check kind's read tracer for Python (#30), as check.kind@1's tracer.mjs is for Node (#314): on the
# run's PYTHONPATH, every Python process of the run loads it at startup, and an audit hook records every file the
# process opens for reading (its imports too) in the file DEEP_CHECK_READS names, and every program it starts in
# the file DEEP_CHECK_SPAWNS names, with whether the child's environment still loads the run's tracers (Python's and
# Node's), so the runner judges a Python's child as it judges a Node's. Each file ends in
# a trailer counting this process's lines. A Python started with -I, -S or -E never loads it: the runner never
# counts a run that starts one.
import atexit
import json
import os
import sys

_files = {'reads': os.environ.get('DEEP_CHECK_READS'), 'spawns': os.environ.get('DEEP_CHECK_SPAWNS')}
_counts = {'reads': 0, 'spawns': 0}
_fds = {}
for _name, _path in _files.items():
    if _path:
        try:
            _fds[_name] = os.open(_path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        except OSError:
            pass  # the runner's file; no trace is no count


def _write(name, line):
    fd = _fds.get(name)
    if fd is None:
        return
    try:
        os.write(fd, (line + '\n').encode('utf-8', 'surrogateescape'))
        _counts[name] += 1
    except OSError:
        pass  # the runner's file; a failed write loses one line


def _text(value):
    if isinstance(value, bytes):
        return os.fsdecode(value)
    return str(value)


def _read(path):
    if isinstance(path, int) or path is None:
        return
    try:
        path = os.path.abspath(_text(os.fspath(path)))
    except (TypeError, ValueError):
        return
    if '\n' in path:
        return
    _write('reads', path)
    # A read through a symbolic link is a read of the file it points to as well.
    try:
        real = os.path.realpath(path)
    except (OSError, ValueError):
        return
    if real != path:
        _write('reads', real)


_HERE = os.path.dirname(os.path.abspath(__file__))
_NODE_OPTIONS = os.environ.get('NODE_OPTIONS')


def _loads_tracer(env):
    """Whether a child given this environment (None: this process's) loads this tracer and writes where this one does."""
    env = os.environ if env is None else env

    def value(name):
        for key in (name, os.fsencode(name)):
            try:
                return _text(env[key])
            except (KeyError, TypeError):
                continue
        return None

    try:
        paths = (value('PYTHONPATH') or '').split(os.pathsep)
        same = all(value(k) == _files[n] for n, k in (('reads', 'DEEP_CHECK_READS'), ('spawns', 'DEEP_CHECK_SPAWNS')))
        # The run's Node loaders too: a Node child given other options runs without the tracer.
        return paths[0] == _HERE and value('PYTHONHOME') is None and same and _NODE_OPTIONS is not None and value('NODE_OPTIONS') == _NODE_OPTIONS
    except Exception:
        return False


def _spawn(file, args, shell, env):
    try:
        argv = [_text(a) for a in args] if isinstance(args, (list, tuple)) else ([_text(args)] if args is not None else [])
        _write('spawns', json.dumps({'file': _text(file), 'args': argv, 'shell': shell, 'detached': False, 'traced': _loads_tracer(env)}, separators=(',', ':')))
    except (TypeError, ValueError):
        pass


def _hook(event, args):
    if event == 'open':
        path, mode, flags = args
        reading = ('r' in mode or '+' in mode) if isinstance(mode, str) else (flags & os.O_ACCMODE) in (os.O_RDONLY, os.O_RDWR)
        if reading:
            _read(path)
    elif event == 'subprocess.Popen':
        executable, argv, env = args[0], args[1], args[3]
        argv = [argv] if isinstance(argv, (str, bytes)) else list(argv or [])
        _spawn(executable or (argv[0] if argv else ''), argv[1:], False, env)
    elif event == 'os.system':
        _spawn('/bin/sh', ['-c', args[0]], False, None)
    elif event in ('os.posix_spawn', 'os.exec', 'os.spawn'):
        path, argv, env = (args[1], args[2], args[3]) if event == 'os.spawn' else (args[0], args[1], args[2])
        _spawn(path, list(argv or [])[1:], False, env)
        # The program that takes this process's place writes trailers of its own: this one closes its lines now.
        if event == 'os.exec':
            _close()


def _close():
    for name, fd in _fds.items():
        try:
            os.write(fd, (json.dumps({'deep': 'end', 'lines': _counts[name]}, separators=(',', ':')) + '\n').encode())
        except OSError:
            pass
        _counts[name] = 0


def _forked():
    # A forked child counts only the lines it writes itself: its parent's trailer counts the rest.
    for name in _counts:
        _counts[name] = 0


if _fds:
    atexit.register(_close)
    os.register_at_fork(after_in_child=_forked)
    sys.addaudithook(_hook)
