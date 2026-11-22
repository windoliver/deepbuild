// For tests/count-linux.test.mjs: holds every hardware counter of one core with pinned events on itself while it
// works, so an instruction counter that follows it from outside doesn't run then. `pin` holds them for all of its
// work; `pin brief` lets them go after about 20 ms of it (10 M steps at 2 ns), then works on counted. Pinned instruction events too,
// for a core whose instructions event has a fixed counter of its own (Intel, arm with FEAT_PMUv3_ICNTR).
#define _GNU_SOURCE
#include <dirent.h>
#include <linux/perf_event.h>
#include <sched.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

int main(int argc, char **argv) {
  // The first core this process may run on, and only that one.
  cpu_set_t allowed, core;
  if (sched_getaffinity(0, sizeof allowed, &allowed)) return 2;
  int first = 0;
  while (first < CPU_SETSIZE && !CPU_ISSET(first, &allowed)) first++;
  CPU_ZERO(&core);
  CPU_SET(first, &core);
  if (first == CPU_SETSIZE || sched_setaffinity(0, sizeof core, &core)) return 2;
  int brief = argc > 1 && !strcmp(argv[1], "brief"), fds[64 * 17], open_fds = 0;
  // One kind of core or two: pinned events for each core PMU, and the generic hardware type where none names one.
  unsigned types[17] = { 0 };
  int kinds = 1, held = 0;
  DIR *pmus = opendir("/sys/bus/event_source/devices");
  struct dirent *pmu;
  while (pmus && kinds < 17 && (pmu = readdir(pmus))) {
    char path[512];
    snprintf(path, sizeof path, "/sys/bus/event_source/devices/%.200s/cpus", pmu->d_name);
    if (pmu->d_name[0] == '.' || access(path, R_OK)) continue;
    snprintf(path, sizeof path, "/sys/bus/event_source/devices/%.200s/type", pmu->d_name);
    FILE *f = fopen(path, "r");
    if (f && fscanf(f, "%u", &types[kinds]) == 1) kinds++;
    if (f) fclose(f);
  }
  if (pmus) closedir(pmus);
  static const uint64_t events[] = { PERF_COUNT_HW_CPU_CYCLES, PERF_COUNT_HW_INSTRUCTIONS };
  for (int kind = 0; kind < kinds; kind++)
    for (int at = 0; at < 64; at++) {
      struct perf_event_attr attr;
      memset(&attr, 0, sizeof attr);
      attr.size = sizeof attr;
      attr.type = PERF_TYPE_HARDWARE;
      attr.config = events[at % 2] | ((uint64_t)types[kind] << 32);
      attr.pinned = 1;
      attr.exclude_kernel = 1;
      int fd = (int)syscall(SYS_perf_event_open, &attr, 0, -1, -1, 0);
      if (fd >= 0) held++;
      if (fd >= 0) fds[open_fds++] = fd;
    }
  if (!held) return 3;
  volatile uint64_t sum = 0;
  if (brief) {
    for (uint64_t at = 0; at < 10000000ull; at++) sum += at;
    for (int at = 0; at < open_fds; at++) close(fds[at]);
  }
  for (uint64_t at = 0; at < 200000000ull; at++) sum += at;
  return 0;
}
