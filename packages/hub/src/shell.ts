/** One argument to a POSIX shell, including whitespace and single quotes. */
export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
