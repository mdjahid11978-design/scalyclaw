---
name: Bitbucket
description: Bitbucket REST API 2.0 — repos, pull requests, branches, issues, pipelines, and more
script: scripts/main.ts
language: javascript
install: none
timeout: 30
---

# Bitbucket

Interact with Bitbucket via REST API 2.0 using fetch(). Supports repositories, pull requests, branches, tags, issues, pipelines, source browsing, workspaces, and users.

## Secrets

- `BITBUCKET_USERNAME` (required): Bitbucket username
- `BITBUCKET_APP_PASSWORD` (required): App password with appropriate scopes
- `BITBUCKET_BASE_URL` (optional): API base URL for Bitbucket Server (default: `https://api.bitbucket.org/2.0`)

## Input

- `action` (string, required): The API operation to perform
- Additional parameters vary by action (see below)

## Actions

### Repos
- `repo_get` — `{ workspace, repo_slug }`
- `repo_list` — `{ workspace, per_page?, page? }`
- `repo_create` — `{ workspace, repo_slug, description?, is_private?, scm? }`
- `repo_delete` — `{ workspace, repo_slug }`
- `repo_forks` — `{ workspace, repo_slug, per_page? }`

### Pull Requests
- `pr_list` — `{ workspace, repo_slug, state?, per_page?, page? }`
- `pr_get` — `{ workspace, repo_slug, pr_id }`
- `pr_create` — `{ workspace, repo_slug, title, source_branch, destination_branch?, description?, close_source_branch? }`
- `pr_update` — `{ workspace, repo_slug, pr_id, title?, description? }`
- `pr_merge` — `{ workspace, repo_slug, pr_id, merge_strategy?, close_source_branch? }`
- `pr_approve` — `{ workspace, repo_slug, pr_id }`
- `pr_decline` — `{ workspace, repo_slug, pr_id }`
- `pr_diff` — `{ workspace, repo_slug, pr_id }`
- `pr_comments` — `{ workspace, repo_slug, pr_id, body? }` (GET if no body, POST if body)
- `pr_activity` — `{ workspace, repo_slug, pr_id }`

### Branches & Tags
- `branch_list` — `{ workspace, repo_slug, per_page?, page? }`
- `branch_create` — `{ workspace, repo_slug, name, target }`
- `branch_delete` — `{ workspace, repo_slug, name }`
- `tag_list` — `{ workspace, repo_slug, per_page?, page? }`
- `tag_create` — `{ workspace, repo_slug, name, target, message? }`

### Issues
- `issue_list` — `{ workspace, repo_slug, state?, per_page?, page? }`
- `issue_get` — `{ workspace, repo_slug, issue_id }`
- `issue_create` — `{ workspace, repo_slug, title, content?, kind?, priority? }`
- `issue_update` — `{ workspace, repo_slug, issue_id, title?, content?, state?, kind?, priority? }`

### Pipelines
- `pipeline_list` — `{ workspace, repo_slug, per_page?, page? }`
- `pipeline_get` — `{ workspace, repo_slug, pipeline_uuid }`
- `pipeline_trigger` — `{ workspace, repo_slug, target_branch, variables? }`
- `pipeline_stop` — `{ workspace, repo_slug, pipeline_uuid }`
- `pipeline_steps` — `{ workspace, repo_slug, pipeline_uuid }`
- `step_log` — `{ workspace, repo_slug, pipeline_uuid, step_uuid }`

### Content
- `src_get` — `{ workspace, repo_slug, path, ref? }`
- `src_list` — `{ workspace, repo_slug, path?, ref? }`

### Other
- `user_get` — Get authenticated user
- `workspace_list` — `{ per_page?, page? }`
- `workspace_members` — `{ workspace, per_page? }`

## Output

JSON object with `data` (API response) and `pagination` (next/previous page URLs).

## Notes

- Bitbucket uses workspace/repo_slug pattern for repository identification
- App passwords are separate from account passwords — create at Bitbucket Settings > App passwords
