// The planted budget child: a program built here, as the budgets' Rust binaries are, that spins a
// fixed number of iterations, says so on stdout and exits. Its instructions retired hold steady under
// any load: it has no JIT and no threads. With a second argument it then sleeps that many seconds, to
// outlive the command that started it.
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(int argc, char **argv) {
  unsigned long target = strtoul(argv[1], NULL, 10);
  for (volatile unsigned long i = 0; i < target; i++) {}
  printf("spun %lu\n", target);
  fflush(stdout);
  if (argc > 2) sleep((unsigned) atoi(argv[2]));
  return 0;
}
