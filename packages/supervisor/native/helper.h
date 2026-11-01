// What the helper's platform file adds to helper.c's commands.
#include <stdio.h>

#ifdef __linux__
/** The `box` and `confine` commands (linux.c): their exit status, or -1 for a command that isn't theirs. */
int linux_command(int argc, char **argv);
/** The `devices` lines on Linux, written to `out`. */
int devices_linux(FILE *out);
#endif
