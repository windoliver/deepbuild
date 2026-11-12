# Owner actions needed after conversational approval

The owner explicitly approved proceeding and then requested **one PR**. #2321 is now the sole review surface; #2336 and #2337 are closed as superseded, with all helper/evidence bytes verified already present in #2321. #2321 remains draft because required proof is missing. No approval signature, signer-list change, merge or issue closure was performed by the agent.

## 1. Establish the repository's approval trust — owner only

The live main branch still has no `.deepbuild/approvers`. The design and `scripts/proof-guard.mjs` require the first list to land on main by a person's own push. A chat approval or a GitHub review does not satisfy the checked signature format.

In a separate clean owner-controlled checkout:

1. Select an existing presence-requiring SSH key, or create one with the supported hardware/platform authenticator. Accepted public-key types are `sk-ssh-ed25519@openssh.com` and `sk-ecdsa-sha2-nistp256@openssh.com`.
2. Add an SSH allowed-signers row to `.deepbuild/approvers`, using a public principal and that public key. Do not put a private key or token in the file. A plain software SSH key is rejected by this guard.
3. Review and personally push that bootstrap commit to main. The agent must not perform the bootstrap/signing operation.
4. Bring the proposal branches onto the updated main **without rewriting the commits to be approved**, then confirm their merge base contains the signer list:

   ```sh
   git fetch origin main
   git merge --no-edit origin/main
   base=$(git merge-base HEAD origin/main)
   git show "$base:.deepbuild/approvers"
   ```

## 2. Sign exact proposals — owner only

Review the actual diff of each protected commit in **#2321 only**. `human-approval-items.txt` lists those commits and every file each touches. The independent #374/#375 redrafts are adopted together in `57d96a3f2bfc1fb88c2934165c48071c27c390dc`, before the scheduling commit. The separate #2336/#2337 commit IDs are historical provenance, not additional merge/signing dependencies.

For each reviewed commit, generate its approval-message file locally and inspect it; **do not approve a generated list without reviewing the diff**:

```sh
commit='<exact-reviewed-commit>'
git show --stat "$commit"
git show "$commit"
git diff-tree --no-commit-id --name-only -r "$commit" |
  while IFS= read -r path; do printf 'Approves: %s\n' "$path"; done > approval.txt
```

After review, personally create and push the annotated signed tag, responding to the authenticator's touch/PIN/biometric request:

```sh
tag="deep/approved/1123-${commit}"
git -c gpg.format=ssh -c user.signingkey='<your-presence-key-path>' \
  tag -s "$tag" "$commit" -F approval.txt
git push origin "refs/tags/$tag"
```

These commands are owner instructions, not commands the agent has executed or may execute as the owner. A tag on the branch tip alone does not approve earlier protected commits; the guard verifies each exact commit and that the approval names all its changed files. Do not change the guard or its inputs to bypass this.

Then run the existing guard and preserve its real result. Review and land the approved helper-adoption and scheduling commits together through #2321, as the owner requested. If the branch has new/rebased SHAs, regenerate the review list from those SHAs rather than signing stale IDs.

## 3. Supply proof capacity/access

- Provide the actual SSH endpoint/user for Spark, or restore the documented `spark-ts` name. No alternate configured address was found. Linux-container results are supplemental only.
- Arrange a quiet Mac admission interval without killing unrelated sessions. The previous complete pair request exhausted the documented 60-minute timed window with no grant. The same source/test pair and overlay recipe are ready under `/tmp/deep-1123-complete/full-pair/`; neither side executed.
- Once capacity or access has genuinely changed, run the prepared complete pair once through the existing throttle. Do not change HOME, forge a grant, relax a load gate, or substitute a sample for the full unit lane. Record complete alone-block intervals, statuses, skips and source hashes.

Only after these actions and the remaining non-PASS verification results are resolved can #2321 claim completion and #1123 close. The conversational approval changes permission to proceed; it does not manufacture those check results.
