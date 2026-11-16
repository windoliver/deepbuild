// Live-PID boundary reading for hub.mjs. Same kernel counter as the perf lane's count-children.c; children apart.
#include <errno.h>
#include <libproc.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>

int main(int argc, char **argv) {
  if (argc != 2) return 3;
  char *end;
  errno = 0;
  long pid = strtol(argv[1], &end, 10);
  struct rusage_info_v4 usage;
  if (errno || !*argv[1] || *end || pid <= 0 || pid > INT32_MAX ||
      proc_pid_rusage((pid_t)pid, RUSAGE_INFO_V4, (rusage_info_t *)&usage) || !usage.ri_instructions) return 3;
  printf("%llu\n", usage.ri_instructions);
  return 0;
}
