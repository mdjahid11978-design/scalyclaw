---
name: GitHub
description: GitHub REST API v3 — repos, issues, PRs, branches, releases, actions, gists, and more
script: scripts/main.ts
language: javascript
install: none
timeout: 30
---

# GitHub

Interact with GitHub via REST API v3 using fetch(). Supports repositories, issues, pull requests, branches, releases, GitHub Actions, gists, file content, user info, and search.

## Secrets

- `GITHUB_TOKEN` (required): Personal access token or fine-grained token
- `GITHUB_BASE_URL` (optional): API base URL for GitHub Enterprise (default: `https://api.github.com`)

## Input

- `action` (string, required): The API operation to perform
- Additional parameters vary by action (see below)

## Actions

### Repos
- `repo_get` — `{ owner, repo }`
- `repo_list` — `{ owner?, per_page?, page?, type?, sort? }` (omit owner for authenticated user)
- `repo_create` — `{ name, description?, private?, auto_init? }`
- `repo_delete` — `{ owner, repo }`
- `repo_topics` — `{ owner, repo, names? }` (GET if no names, PUT if names provided)
- `repo_collaborators` — `{ owner, repo }`

### Issues
- `issue_list` — `{ owner, repo, state?, labels?, assignee?, per_page?, page? }`
- `issue_get` — `{ owner, repo, number }`
- `issue_create` — `{ owner, repo, title, body?, labels?, assignees? }`
- `issue_update` — `{ owner, repo, number, title?, body?, state?, labels?, assignees? }`
- `issue_comments` — `{ owner, repo, number, body? }` (GET if no body, POST if body provided)

### Pull Requests
- `pr_list` — `{ owner, repo, state?, head?, base?, per_page?, page? }`
- `pr_get` — `{ owner, repo, number }`
- `pr_create` — `{ owner, repo, title, head, base, body?, draft? }`
- `pr_update` — `{ owner, repo, number, title?, body?, state?, base? }`
- `pr_merge` — `{ owner, repo, number, merge_method?, commit_title? }`
- `pr_reviews` — `{ owner, repo, number }`
- `pr_files` — `{ owner, repo, number }`
- `pr_diff` — `{ owner, repo, number }`

### Branches
- `branch_list` — `{ owner, repo, per_page?, page? }`
- `branch_get` — `{ owner, repo, branch }`
- `branch_protection` — `{ owner, repo, branch }`

### Releases
- `release_list` — `{ owner, repo, per_page? }`
- `release_get` — `{ owner, repo, tag? }` (latest if no tag)
- `release_create` — `{ owner, repo, tag_name, name?, body?, draft?, prerelease?, target_commitish? }`

### Actions / CI
- `workflow_list` — `{ owner, repo }`
- `workflow_runs` — `{ owner, repo, workflow_id?, status?, branch?, per_page? }`
- `workflow_dispatch` — `{ owner, repo, workflow_id, ref, inputs? }`
- `run_get` — `{ owner, repo, run_id }`
- `run_logs` — `{ owner, repo, run_id }`
- `run_cancel` — `{ owner, repo, run_id }`
- `run_rerun` — `{ owner, repo, run_id }`

### Gists
- `gist_list` — `{ per_page?, page? }`
- `gist_get` — `{ gist_id }`
- `gist_create` — `{ description?, files, public? }`
- `gist_update` — `{ gist_id, description?, files }`

### Content
- `content_get` — `{ owner, repo, path, ref? }`
- `content_create_or_update` — `{ owner, repo, path, message, content, sha?, branch? }`

### Other
- `user_get` — `{ username? }` (authenticated user if no username)
- `search` — `{ type, q, per_page?, page? }` (type: repositories, issues, code, users)

## Output

JSON object with `data` (API response), `pagination` (link headers), and `rateLimit` (remaining/reset).
