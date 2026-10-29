// Prints, for each path, `<path>\t<bytes>`: the bytes APFS keeps private to that file, that is the blocks no clone
// shares (getattrlist's ATTR_CMNEXT_PRIVATESIZE), or `unknown` where the file system doesn't say. A file cloned
// copy-on-write (clonefile, `cp -c`) reads 0 while its clone lives; a byte copy leaves it at the file's size. The
// suite compiles it with `cc` at run time (helpers.ts, privateSizes). Exit 1 when a path can't be read.
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <sys/attr.h>
#include <unistd.h>

struct reply {
  uint32_t length;
  attribute_set_t returned;
  off_t private_size;
} __attribute__((aligned(4), packed));

int main(int argc, char **argv) {
  int bad = 0;
  for (int i = 1; i < argc; i++) {
    struct attrlist want;
    memset(&want, 0, sizeof want);
    want.bitmapcount = ATTR_BIT_MAP_COUNT;
    want.commonattr = ATTR_CMN_RETURNED_ATTRS;
    want.forkattr = ATTR_CMNEXT_PRIVATESIZE;
    struct reply r;
    memset(&r, 0, sizeof r);
    if (getattrlist(argv[i], &want, &r, sizeof r, FSOPT_ATTR_CMN_EXTENDED | FSOPT_NOFOLLOW) != 0) { perror(argv[i]); bad = 1; continue; }
    if (!(r.returned.forkattr & ATTR_CMNEXT_PRIVATESIZE)) { printf("%s\tunknown\n", argv[i]); continue; }
    printf("%s\t%lld\n", argv[i], (long long)r.private_size);
  }
  return bad;
}
