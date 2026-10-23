# The command check kind's pytest reporter (#30), loaded through PYTEST_PLUGINS: one JSON line per test that ran,
# per file that failed to collect and per error outside any test, in the format of the runner's Vitest reporter
# (vitest-reporter.mjs), written to the file the runner names. testsRun, each attempt and each failure's place and
# kind come from pytest's own outcome and the exception it caught, never from printed output: a test that prints
# "AssertionError" and then raises an AttributeError is an AttributeError. It ends with a trailer counting its lines.
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
    value = config.getoption('keyword', None)
    if value:
        _write({'type': 'run:error', 'file': None, 'filter': value, 'errors': [{'name': 'Error', 'message': f"tests left out by -k {value} that the check's command doesn't name", 'stack': None, 'frames': []}]})
    for value in config.getoption('deselect', None) or []:
        _write({'type': 'run:error', 'file': None, 'filter': value, 'errors': [{'name': 'Error', 'message': f"tests left out by --deselect {value} that the check's command doesn't name", 'stack': None, 'frames': []}]})


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    report.deep_file = os.path.abspath(str(item.path))
    if call.excinfo is not None and report.failed:
        report.deep_error = _error(call.excinfo, report.longreprtext)


class _Reporter:
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
    try:
        os.write(_fd, (json.dumps({'deep': 'end', 'lines': _lines}, separators=(',', ':')) + '\n').encode())
    except OSError:
        pass
    _fd = None
