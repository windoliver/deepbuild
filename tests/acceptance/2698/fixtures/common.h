// Shared by the #2698 fixtures: fixed work, the process's own clocks and counters, and one line in, one line out.
// Every fixture ends by itself when its stdin closes or after WATCHDOG seconds, so none outlives a test that died.
#include <errno.h>
#include <libproc.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>

#define WATCHDOG 600

// Fixed work: the same instructions for the same loops, whatever core or load it runs at. The four sums stay in
// registers and each loop is a few instructions with nothing to wait for, so 100 ms of it retires billions: what
// the kernel adds to a busy process's count under load (interrupts, switches) stays a small share of the whole.
static inline uint64_t spin(uint64_t loops) {
  uint64_t a = 1, b = 2, c = 3, d = 4;
  for (uint64_t i = 0; i < loops; i++) {
    a += i;
    b ^= a;
    c += b >> 3;
    d ^= c + i;
    // Keeps the compiler from folding the loop away or widening it: each sum is a value it can't see through.
    __asm__ volatile("" : "+r"(a), "+r"(b), "+r"(c), "+r"(d));
  }
  return a ^ b ^ c ^ d;
}

// This process's user and system CPU time so far, in microseconds, by getrusage.
static inline uint64_t cpu_us(void) {
  struct rusage usage;
  getrusage(RUSAGE_SELF, &usage);
  return (uint64_t)(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) * 1000000ULL + (uint64_t)(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec);
}

static inline uint64_t wall_us(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (uint64_t)now.tv_sec * 1000000ULL + (uint64_t)now.tv_nsec / 1000ULL;
}

// What the kernel has counted for this process itself: 0 for a count it doesn't keep.
static inline void own_counts(uint64_t *instructions, uint64_t *interrupt_wakeups, uint64_t *idle_wakeups) {
  struct rusage_info_v4 usage;
  memset(&usage, 0, sizeof usage);
  proc_pid_rusage(getpid(), RUSAGE_INFO_V4, (rusage_info_t *)&usage);
  *instructions = usage.ri_instructions;
  *interrupt_wakeups = usage.ri_interrupt_wkups;
  *idle_wakeups = usage.ri_pkg_idle_wkups;
}

// The loops this machine spins in `ms` of this process's CPU time, now.
static inline uint64_t calibrate(uint64_t ms) {
  const uint64_t chunk = 2000000;
  uint64_t loops = 0, start = cpu_us();
  while (cpu_us() - start < ms * 1000ULL) {
    spin(chunk);
    loops += chunk;
  }
  return loops;
}

// One timed sleep: the process blocks and a timer wakes it.
static inline void nap(long ms) {
  struct timespec left = { ms / 1000, (ms % 1000) * 1000000L };
  while (nanosleep(&left, &left) && errno == EINTR) continue;
}

// Anonymous memory, every page written with bytes of its own.
static inline unsigned char *hold(size_t bytes) {
  unsigned char *memory = mmap(NULL, bytes, PROT_READ | PROT_WRITE, MAP_ANON | MAP_PRIVATE, -1, 0);
  if (memory == MAP_FAILED) return NULL;
  size_t page = (size_t)getpagesize();
  uint64_t word = 0x9e3779b97f4a7c15ULL;
  for (size_t at = 0; at < bytes; at += page) {
    for (size_t i = 0; i < 256 && at + i + sizeof word <= bytes; i += sizeof word) {
      word = word * 6364136223846793005ULL + 1442695040888963407ULL;
      memcpy(memory + at + i, &word, sizeof word);
    }
  }
  return memory;
}

// Waits for one line on stdin. A closed stdin ends the fixture: its test has gone.
static inline void await_line(void) {
  char line[64];
  if (!fgets(line, sizeof line, stdin)) _exit(0);
}
