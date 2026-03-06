---
name: Git Operations
description: Complete local and remote git operations (init, clone, commit, push, pull, branch, merge, rebase, tag, stash, and more)
script: scripts/main.ts
language: javascript
install: none
timeout: 60
---

# Git Operations

Full git CLI wrapper using Bun.spawn. Supports all common local and remote git operations.

## Secrets (optional)

- `GIT_USERNAME`: Author name for commits
- `GIT_EMAIL`: Author email for commits
- `GIT_PASSWORD`: Password/token for authenticated HTTPS remote operations

## Input

- `action` (string, required): The git operation to perform
- `cwd` (string, optional): Working directory (defaults to process current directory)
- Additional parameters vary by action (see below)

## Actions

### Repository
- `init` — `{ path? }` Initialize a new repo
- `clone` — `{ url, path?, depth?, branch? }` Clone a repository
- `config` — `{ key, value?, global? }` Get or set git config

### Staging & Commits
- `status` — Get working tree status
- `add` — `{ files }` Stage files (array of paths, or `["."]` for all)
- `reset_stage` — `{ files? }` Unstage files
- `commit` — `{ message, all? }` Create a commit
- `cherry_pick` — `{ commits }` Cherry-pick commits
- `revert` — `{ commit }` Revert a commit

### Branching
- `branches` — List branches (`{ all?, remote? }`)
- `branch_create` — `{ name, start_point? }`
- `branch_delete` — `{ name, force? }`
- `branch_rename` — `{ old_name, new_name }`
- `checkout` — `{ ref, create? }`
- `switch` — `{ branch, create? }`

### Remote
- `remote_list` — List remotes
- `remote_add` — `{ name, url }`
- `remote_remove` — `{ name }`
- `fetch` — `{ remote?, prune? }`
- `pull` — `{ remote?, branch?, rebase? }`
- `push` — `{ remote?, branch?, force?, set_upstream?, tags? }`

### Merge & Rebase
- `merge` — `{ branch, no_ff?, message? }`
- `rebase` — `{ branch, onto? }`

### History
- `log` — `{ count?, ref?, path?, oneline?, author?, since?, until? }`
- `diff` — `{ from_ref?, to_ref?, path?, staged?, stat? }`
- `show` — `{ ref? }`
- `blame` — `{ path, lines? }`

### Tags
- `tag_list` — List tags
- `tag_create` — `{ name, message?, ref? }`
- `tag_delete` — `{ name }`

### Stash
- `stash_save` — `{ message? }`
- `stash_list` — List stashes
- `stash_apply` — `{ index? }`
- `stash_drop` — `{ index? }`

### Advanced
- `clean` — `{ force?, directories?, dry_run? }`
- `reset` — `{ ref?, mode? }` (soft/mixed/hard)

## Output

JSON object with the result of the operation. Structure varies by action.
