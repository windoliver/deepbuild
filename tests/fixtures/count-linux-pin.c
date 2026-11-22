// For tests/count-linux.test.mjs: holds every hardware counter of core 0 with pinned events on itself, then works,
// so an instruction counter that follows it from outside never runs while it does.
#define _GNU_SOURCE
#include <dirent.h>
#include <linux/perf_event.h>
#include <sched.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

int main(void) {
  cpu_set_t core;
  CPU_ZERO(&core);
  CPU_SET(0, &core);
  if (sched_setaffinity(0, sizeof core, &core)) return 2;
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
  for (int kind = 0; kind < kinds; kind++)
    for (int at = 0; at < 32; at++) {
      struct perf_event_attr attr;
      memset(&attr, 0, sizeof attr);
      attr.size = sizeof attr;
      attr.type = PERF_TYPE_HARDWARE;
      attr.config = PERF_COUNT_HW_CPU_CYCLES | ((uint64_t)types[kind] << 32);
      attr.pinned = 1;
      attr.exclude_kernel = 1;
      if (syscall(SYS_perf_event_open, &attr, 0, -1, -1, 0) >= 0) held++;
    }
  if (!held) return 3;
  volatile uint64_t sum = 0;
  for (uint64_t at = 0; at < 200000000ull; at++) sum += at;
  return 0;
}
