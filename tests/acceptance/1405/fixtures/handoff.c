// The planted two-thread spin bench: two threads pass a token back and forth through one atomic word,
// each spinning on it until its turn comes, with no yield and no lock. It does the same work every run;
// what moves is how long each thread spins while the other waits to be scheduled, and a spinning thread
// retires instructions the whole time. So its instructions retired move with the schedule, as the
// issue says spin code's do.
//
//   handoff <handoffs> [work] [extra]   passes the token <handoffs> times, spinning a volatile counter
//                               <work> times (default 2000) on each turn; then, with the other thread
//                               gone, spins the counter <extra> times (default 0), a fixed amount of
//                               work no schedule moves; and prints "handed <handoffs>". The extra comes
//                               last because work run before the handoffs changes how they are scheduled.
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>

static _Atomic unsigned long turn;
static unsigned long handoffs, work = 2000;

static void *player(void *first) {
  for (unsigned long mine = (unsigned long)first; mine < 2 * handoffs; mine += 2) {
    while (atomic_load_explicit(&turn, memory_order_acquire) != mine) {}
    for (volatile unsigned long i = 0; i < work; i++) {}
    atomic_store_explicit(&turn, mine + 1, memory_order_release);
  }
  return NULL;
}

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  handoffs = strtoul(argv[1], NULL, 10);
  if (argc > 2) work = strtoul(argv[2], NULL, 10);
  pthread_t other;
  if (pthread_create(&other, NULL, player, (void *)1)) return 3;
  player((void *)0);
  pthread_join(other, NULL);
  unsigned long extra = argc > 3 ? strtoul(argv[3], NULL, 10) : 0;
  for (volatile unsigned long i = 0; i < extra; i++) {}
  printf("handed %lu\n", handoffs);
  return 0;
}
