# Runs a command in a real pseudo-terminal, copying this process's stdin to it and its output to stdout, with the
# terminal's echo on until the command turns it off. Exits with the command's exit code (#70 AC3).
import os
import pty
import sys

sys.exit(os.waitstatus_to_exitcode(pty.spawn(sys.argv[1:])))
