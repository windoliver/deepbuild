// Prints the instructions retired so far by each live process named on the command line, one line each, as the perf
// lane's counter reads a process (scripts/count-children.c): proc_pid_rusage's ri_instructions, that process's own
// threads and none of its children's. Exit 3 with nothing printed when the kernel gives no count or a 0: a missing
// count is never 0.
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  for (int i = 1; i < argc; i++) {
    struct rusage_info_v4 usage;
    if (proc_pid_rusage(atoi(argv[i]), RUSAGE_INFO_V4, (rusage_info_t *)&usage) || !usage.ri_instructions) return 3;
    printf("%llu\n", usage.ri_instructions);
  }
  return 0;
}
