/* The test's deep-confirm binary (README: The helper's protocol): a launcher compiled per test with the paths and the
 * role as -D defines, then ad-hoc signed, so it has a code identity of its own and two roles are two identities. It
 * runs `NODE_PATH SCRIPT_PATH CONFIG_PATH ROLE <its own arguments…>` in its place, keeping stdin, stdout and stderr. */
#include <stdio.h>
#include <unistd.h>

int main(int argc, char **argv) {
  char *args[argc + 4];
  args[0] = (char *)NODE_PATH;
  args[1] = (char *)SCRIPT_PATH;
  args[2] = (char *)CONFIG_PATH;
  args[3] = (char *)ROLE;
  for (int i = 1; i < argc; i++) args[i + 3] = argv[i];
  args[argc + 3] = NULL;
  execv(NODE_PATH, args);
  perror("deep-confirm (the #880 test launcher): execv");
  return 127;
}
