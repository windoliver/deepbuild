# Review rubric

The rules a review finding may cite, in the order the send-back lists them.

- unchecked-parse: JSON.parse on input that isn't validated or caught
- swallowed-error: a catch block that drops the error
- off-by-one: a loop bound or index that reaches one past the end
- missing-await: a promise used without await where its result or failure matters
- sql-concat: SQL built by concatenating outside input
- secret-in-code: a credential or token written in source
