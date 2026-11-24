// #2960 fixture: a small program the counter's library can enter (not a platform binary). With no argument it does a
// little work, prints its name and exits 0; `tool pause` waits until it is killed.
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc > 1 && !strcmp(argv[1], "pause")) for (;;) pause();
  volatile unsigned long sum = 0;
  for (unsigned long i = 0; i < 1000000; i++) sum += i;
  printf("%s %lu\n", argv[0], (unsigned long)sum);
  return 0;
}
