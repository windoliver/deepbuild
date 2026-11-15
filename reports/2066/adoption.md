# Approved acceptance adoption for #2066

The owner answered **yes** to: “Do you approve adopting the blind redraft presented in #2519?” The presented proposal explicitly covered replacing the earlier drafts with `tests/acceptance/2066/redraft/recorded-origin.test.ts` and adding the missing hashed criterion tags for the trace lane.

This adoption therefore:

- retires `origin.test.ts` and the first `recorded-origin.test.ts`, which failed on their infrastructure, and the first socket draft's description;
- keeps the adopted redraft's input, assertions, expected values and test flow unchanged, adding only criterion tags to its two test names;
- retains the superseded bytes in Git history and all saved before/after failures under `reports/2066/`;
- supplies a wrong-program twin for the unchanged person behavior: reverse only the `from === 'person'` save guard so AC3 must detect the regression. No expected value or test is changed to fit that twin.

The behavioral approval is the owner's message, not an agent claim. It is not a cryptographic approval tag and does not waive any machine guard that requires one. No signing command or approval tag was created. The approval does not waive unrelated check failures or authorize merging.
