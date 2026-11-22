// #2960 fixture (criterion 2): starts one child, SIGKILLs it before it ends, and exits 0 without waiting for it, so
// nothing ever reaps it in the run and it never reports itself.
//   killer spawn <program>   the child is <program> pause, started with posix_spawn
//   killer fork              the child is a fork of this process, which waits until it is killed
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

extern char **environ;

int main(int argc, char **argv) {
  pid_t child = -1;
  if (argc == 3 && !strcmp(argv[1], "spawn")) {
    char *args[] = { argv[2], "pause", NULL };
    if (posix_spawn(&child, argv[2], NULL, NULL, args, environ)) { perror("posix_spawn"); return 2; }
  } else if (argc == 2 && !strcmp(argv[1], "fork")) {
    child = fork();
    if (child < 0) { perror("fork"); return 2; }
    if (!child) for (;;) pause();
  } else {
    fprintf(stderr, "usage: killer spawn <program> | killer fork\n");
    return 2;
  }
  usleep(300000);
  if (kill(child, SIGKILL)) { perror("kill"); return 2; }
  // Long enough for the kernel to end it; it stays unreaped by this process.
  usleep(500000);
  return 0;
}
