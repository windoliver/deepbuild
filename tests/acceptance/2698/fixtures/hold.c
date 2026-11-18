// AC2's fixture: a process that holds memory it has touched, half of it compressed by the machine.
//
//   hold <bytes>   prints {"ready":…} and waits for a line; then maps <bytes> (rounded up to whole pages), writes every
//                  page, and prints a status line about four times a second until a line on stdin ends it
//
// It can't compress its own memory: only the machine does, when it wants memory back. So it keeps the first half in
// use, reading every page of it before each status line, and tells the machine it doesn't need the second half now
// (madvise DONTNEED, which on macOS keeps the bytes and only puts the pages first in line). Each status line says
// what the kernel reports then: `compressedBytes`, the held pages that are no longer in core, by mincore, and the
// process's own footprint, resident and compressed bytes, by task_info.
#include "common.h"
#include <mach/mach.h>
#include <poll.h>

int main(int argc, char **argv) {
  alarm(WATCHDOG);
  if (argc != 2) return 2;
  size_t page = (size_t)getpagesize();
  size_t bytes = (size_t)((strtoull(argv[1], NULL, 10) + page - 1) / page) * page;
  if (!bytes) return 2;
  printf("{\"ready\":true,\"pid\":%d}\n", getpid());
  fflush(stdout);
  await_line();
  unsigned char *memory = hold(bytes);
  char *core = malloc(bytes / page);
  if (!memory || !core) return 4;
  size_t used = bytes / 2 / page * page;
  madvise(memory + used, bytes - used, MADV_DONTNEED);
  for (;;) {
    volatile unsigned char sink = 0;
    for (size_t at = 0; at < used; at += page) sink ^= memory[at];
    size_t out = 0;
    if (mincore(memory, bytes, core)) return 4;
    for (size_t i = 0; i < bytes / page; i++) if (!(core[i] & MINCORE_INCORE)) out++;
    task_vm_info_data_t own;
    mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
    memset(&own, 0, sizeof own);
    task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&own, &count);
    printf("{\"heldBytes\":%zu,\"compressedBytes\":%zu,\"own\":{\"footprintBytes\":%llu,\"residentBytes\":%llu,\"compressedBytes\":%llu}}\n",
      bytes, out * page, own.phys_footprint, own.resident_size, own.compressed);
    fflush(stdout);
    struct pollfd in = { STDIN_FILENO, POLLIN, 0 };
    if (poll(&in, 1, 250) > 0) break;
  }
  return 0;
}
