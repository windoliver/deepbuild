# The command check kind's pytest reporter (#30), loaded through PYTEST_PLUGINS: one JSON line per test that ran,
# per file that failed to collect and per error outside any test, in the format of the runner's Vitest reporter
# (vitest-reporter.mjs), written to the file the runner names. testsRun, each attempt and each failure's place and
# kind come from pytest's own outcome and the exception it caught, never from printed output: a test that prints
# "AssertionError" and then raises an AttributeError is an AttributeError. It ends with a trailer counting its lines.
import ast
import inspect
import json
import os

import pytest

# Taken once and dropped from the environment, so no process a test starts learns where the report is. The tests
# themselves share pytest's process with this reporter, which a test bent on it can reach (see the runner's notes).
_report = os.environ.pop('DEEP_CHECK_REPORT', None)
_owner = None
_fd = None
_lines = 0
_tests = {}
# The files the run's session collected tests from, each listed from its source when the run ends.
_modules = set()
# What makes a test, its class or its file one the source itself skips: a skip or xfail mark, unittest's skip
# decorators, or a call to pytest's skip, xfail or importorskip or unittest's skipTest.
_SKIPS = {'skip', 'skipif', 'xfail', 'skipUnless', 'skipTest', 'importorskip'}


def _write(line):
    global _lines
    if _fd is None:
        return
    try:
        os.write(_fd, (json.dumps(line, separators=(',', ':')) + '\n').encode())
        _lines += 1
    except OSError:
        pass  # the runner's file; a failed write loses one line


def _error(excinfo, text):
    """An exception as the report carries it: its class, message, pytest's text of it, and its frames innermost first."""
    frames = [{'file': os.path.abspath(str(entry.path)), 'line': entry.lineno + 1} for entry in reversed(excinfo.traceback)]
    return {'name': excinfo.typename, 'message': f'{excinfo.typename}: {excinfo.value}', 'stack': text, 'frames': frames}


def pytest_configure(config):
    global _fd, _owner
    # The run's own session writes the report: not a worker of a parallel run, which reports through its
    # controller, nor a session a test runs inside it (pytester), whose tests aren't the run's.
    if not _report or _owner is not None or hasattr(config, 'workerinput'):
        return
    _owner = config
    try:
        _fd = os.open(_report, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    except OSError:
        return  # the runner's file; no report is no count
    config.pluginmanager.register(_Reporter(), 'deep_check_reporter')
    # Tests chosen from pytest's cache (the last run's failures, or where a stepwise run stopped) aren't the suite:
    # one the cache leaves out never runs, so such a run can't pass.
    chosen = [flag for flag, dest in (('--lf', 'lf'), ('--sw', 'stepwise'), ('--sw-skip', 'stepwise_skip')) if config.getoption(dest, False)]
    if chosen:
        _write({'type': 'run:error', 'file': None, 'errors': [{'name': 'Error', 'message': f"tests chosen from pytest's cache ({' '.join(chosen)})", 'stack': None, 'frames': []}]})
    # A filter leaves tests of a file out while the file still runs: the runner keeps it only when the check's command names it.
    for flag, dest in (('-k', 'keyword'), ('-m', 'markexpr')):
        value = config.getoption(dest, None)
        if value:
            _write({'type': 'run:error', 'file': None, 'filter': value, 'errors': [{'name': 'Error', 'message': f"tests left out by {flag} {value} that the check's command doesn't name", 'stack': None, 'frames': []}]})
    # Tests a file imports are tests of that file; without the unittest plugin its TestCase classes are never collected.
    try:
        imported = config.getini('collect_imported_tests')
    except ValueError:
        imported = True  # a pytest older than the option
    if not imported:
        _write({'type': 'run:error', 'file': None, 'filter': 'collect_imported_tests=false', 'errors': [{'name': 'Error', 'message': "tests a file imports left out by collect_imported_tests=false that the check's command doesn't name", 'stack': None, 'frames': []}]})
    if config.pluginmanager.is_blocked('unittest'):
        _write({'type': 'run:error', 'file': None, 'errors': [{'name': 'Error', 'message': 'unittest test cases left out by -p no:unittest', 'stack': None, 'frames': []}]})
    for value in config.getoption('deselect', None) or []:
        _write({'type': 'run:error', 'file': None, 'filter': value, 'errors': [{'name': 'Error', 'message': f"tests left out by --deselect {value} that the check's command doesn't name", 'stack': None, 'frames': []}]})


def _names(node):
    return {n.attr if isinstance(n, ast.Attribute) else n.id for n in ast.walk(node) if isinstance(n, (ast.Attribute, ast.Name))}


def _listing(path):
    """The tests a default pytest run of the file at `path` runs, read from its source with none of the checkout's
    config, setup or plugins: test* functions, Test* classes without __init__ and unittest TestCase classes, none abstract, and their
    test* methods, at the top of the file or of a listed class, but those its source skips or makes conditional."""
    try:
        with open(path, 'rb') as f:
            tree = ast.parse(f.read(), path)
    except (OSError, SyntaxError, ValueError):
        return []
    # A file that skips itself, or sets marks on all its tests (pytestmark), lists nothing.
    if any(_SKIPS & _names(n) for n in tree.body if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))):
        return []
    listed = []

    def visit(body, prefix, unit):
        for n in body:
            decorators = set().union(*map(_names, n.decorator_list)) if hasattr(n, 'decorator_list') else set()
            if _SKIPS & decorators or 'fixture' in decorators:
                continue
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name.startswith('test'):
                if not _SKIPS & _names(n):
                    listed.append(('::'.join(prefix + [n.name]), n.lineno))
            elif isinstance(n, ast.ClassDef) and not unit:
                is_unit = any(b.endswith('TestCase') for b in map(ast.unparse, n.bases))
                init = any(isinstance(m, ast.FunctionDef) and m.name == '__init__' for m in n.body)
                # pytest never collects an abstract class, whatever its name.
                abstract = any('abstractmethod' in set().union(*map(_names, m.decorator_list)) for m in n.body if hasattr(m, 'decorator_list'))
                if not abstract and (is_unit or (n.name.startswith('Test') and not init)):
                    visit(n.body, prefix + [n.name], is_unit)

    visit(tree.body, [], False)
    return listed


@pytest.hookimpl(hookwrapper=True)
def pytest_pycollect_makeitem(collector, name, obj):
    # Which functions and classes are tests is pytest's own filter too (python_functions, python_classes): a test_*
    # function or Test* class the project's patterns leave out is a test dropped from a file that still runs. Only the
    # name patterns count: pytest also never collects, say, an abstract class, whatever its name.
    outcome = yield
    if outcome.excinfo is None and outcome.get_result() is None and collector.config is _owner:
        function = inspect.isfunction(obj) or isinstance(obj, (staticmethod, classmethod))
        ini = ('python_functions' if function and name.startswith('test') and not collector.funcnamefilter(name)
               else 'python_classes' if inspect.isclass(obj) and name.startswith('Test') and not collector.classnamefilter(name) else None)
        if ini:
            value = f"{ini}={' '.join(collector.config.getini(ini))}"
            _write({'type': 'run:error', 'file': None, 'filter': value, 'errors': [{'name': 'Error', 'message': f"{collector.nodeid}::{name} left out by {value} that the check's command doesn't name", 'stack': None, 'frames': []}]})
            _write({'type': 'test:left', 'name': f'{collector.nodeid}::{name}'.split('::', 1)[-1], 'file': os.path.abspath(str(collector.path)), 'filter': value, 'errors': []})


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    report.deep_file = os.path.abspath(str(item.path))
    if call.excinfo is not None and report.failed:
        report.deep_error = _error(call.excinfo, report.longreprtext)


class _Reporter:
    def pytest_collectstart(self, collector):
        if isinstance(collector, pytest.Module):
            _modules.add(os.path.abspath(str(collector.path)))

    def pytest_deselected(self, items):
        # Each test pytest's own filters left out, with the filter that did, which is the command's or fails the run.
        deselect = _owner.getoption('deselect', None) or []
        for item in items:
            by = next((v for v in deselect if item.nodeid.startswith(v)), None) or _owner.getoption('keyword', None) or _owner.getoption('markexpr', None)
            if by:
                _write({'type': 'test:left', 'name': item.nodeid.split('::', 1)[-1], 'file': os.path.abspath(str(item.path)), 'filter': by, 'errors': []})

    def pytest_runtest_logreport(self, report):
        # A test's phases (setup, call, teardown) end as one test: failed if any failed, run only if its call ran.
        test = _tests.setdefault(report.nodeid, {'ran': False, 'errors': [], 'retries': 0})
        if report.outcome == 'rerun':
            test['retries'] += 1
            test['errors'] = []
            test['ran'] = False
            return
        if report.when == 'call' and not report.skipped:
            test['ran'] = True
        if report.failed:
            test['ran'] = True
            test['errors'].append(getattr(report, 'deep_error', None) or {'name': None, 'message': str(report.longrepr), 'stack': None, 'frames': []})
        # A rerun's teardown keeps the test's count of attempts for the run that follows it.
        if report.when == 'teardown' and (test['ran'] or not test['retries']):
            del _tests[report.nodeid]
            if test['ran']:
                _write({
                    'type': 'test:fail' if test['errors'] else 'test:pass', 'name': report.nodeid.split('::', 1)[-1],
                    'file': getattr(report, 'deep_file', None), 'retries': test['retries'], 'errors': test['errors'],
                })


    def pytest_collectreport(self, report):
        if report.failed:
            path = report.fspath and os.path.abspath(str(report.fspath))
            _write({'type': 'file:fail', 'file': path, 'errors': [{'name': None, 'message': str(report.longrepr), 'stack': None, 'frames': []}]})


@pytest.hookimpl(trylast=True)
def pytest_unconfigure(config):
    global _fd
    if config is not _owner or _fd is None:
        return
    for path in sorted(_modules):
        for name, line in _listing(path):
            _write({'type': 'test:listed', 'name': name, 'file': path, 'line': line, 'errors': []})
    try:
        os.write(_fd, (json.dumps({'deep': 'end', 'lines': _lines}, separators=(',', ':')) + '\n').encode())
    except OSError:
        pass
    _fd = None
