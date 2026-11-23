// For tests/count-linux.test.mjs: about 0.2 s of user-space work, run as a program its process may execute but not read.
#include <stdint.h>

int main(void) {
  volatile uint64_t sum = 0;
  for (uint64_t at = 0; at < 200000000ull; at++) sum += at;
  return 0;
}
