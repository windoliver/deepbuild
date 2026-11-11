// The two syscalls' own cost on this disk, for comparison with Node's timings.
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e3 + t.tv_nsec / 1e6; }
int main(int argc, char **argv) {
  char buf[8192]; memset(buf, 'x', sizeof buf);
  for (int mode = 0; mode < 2; mode++) {
    double total = 0;
    for (int i = 0; i < 20; i++) {
      int fd = open(argv[1], O_WRONLY | O_CREAT | O_TRUNC, 0600); write(fd, buf, sizeof buf);
      double t = now(); if (mode) fcntl(fd, F_FULLFSYNC); else fsync(fd); total += now() - t; close(fd);
    }
    printf("%s: mean %.2f ms\n", mode ? "fcntl(F_FULLFSYNC)" : "fsync", total / 20);
  }
  unlink(argv[1]);
}
