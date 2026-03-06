---
name: GitLab
description: GitLab REST API v4 — projects, issues, merge requests, branches, pipelines, releases, and more
script: scripts/main.ts
language: javascript
install: none
timeout: 30
---

# GitLab

Interact with GitLab via REST API v4 using fetch(). Supports projects, issues, merge requests, branches, pipelines, releases, files, users, groups, and search.

## Secrets

- `GITLAB_TOKEN` (required): Personal access token or project token
- `GITLAB_BASE_URL` (optional): API base URL for self-hosted GitLab (default: `https://gitlab.com/api/v4`)

## Input

- `action` (string, required): The API operation to perform
- Additional parameters vary by action (see below)

## Actions

### Projects
- `project_get` — `{ project }` (ID or URL-encoded path)
- `project_list` — `{ owned?, membership?, search?, per_page?, page? }`
- `project_create` — `{ name, description?, visibility?, initialize_with_readme? }`
- `project_delete` — `{ project }`
- `project_members` — `{ project, per_page?, page? }`

### Issues
- `issue_list` — `{ project, state?, labels?, assignee_username?, per_page?, page? }`
- `issue_get` — `{ project, iid }`
- `issue_create` — `{ project, title, description?, labels?, assignee_ids? }`
- `issue_update` — `{ project, iid, title?, description?, state_event?, labels?, assignee_ids? }`
- `issue_notes` — `{ project, iid, body? }` (GET if no body, POST if body provided)

### Merge Requests
- `mr_list` — `{ project, state?, source_branch?, target_branch?, per_page?, page? }`
- `mr_get` — `{ project, iid }`
- `mr_create` — `{ project, title, source_branch, target_branch, description? }`
- `mr_update` — `{ project, iid, title?, description?, state_event?, target_branch? }`
- `mr_merge` — `{ project, iid, merge_when_pipeline_succeeds?, squash? }`
- `mr_approve` — `{ project, iid }`
- `mr_changes` — `{ project, iid }`
- `mr_notes` — `{ project, iid, body? }` (GET if no body, POST if body provided)

### Branches
- `branch_list` — `{ project, search?, per_page?, page? }`
- `branch_get` — `{ project, branch }`
- `branch_create` — `{ project, branch, ref }`
- `branch_delete` — `{ project, branch }`
- `branch_protect` — `{ project, branch, push_access_level?, merge_access_level? }`

### Pipelines
- `pipeline_list` — `{ project, ref?, status?, per_page?, page? }`
- `pipeline_get` — `{ project, pipeline_id }`
- `pipeline_create` — `{ project, ref, variables? }`
- `pipeline_cancel` — `{ project, pipeline_id }`
- `pipeline_retry` — `{ project, pipeline_id }`
- `pipeline_jobs` — `{ project, pipeline_id, per_page? }`
- `job_log` — `{ project, job_id }`

### Releases
- `release_list` — `{ project, per_page? }`
- `release_create` — `{ project, tag_name, name?, description?, ref? }`

### Files
- `file_get` — `{ project, path, ref? }`
- `file_create_or_update` — `{ project, path, content, branch, commit_message, encoding? }`

### Other
- `user_get` — Get authenticated user
- `group_list` — `{ search?, per_page?, page? }`
- `search` — `{ scope, search, project? }` (scope: projects, issues, merge_requests, milestones, blobs)

## Output

JSON object with `data` (API response) and `pagination` (headers).

## Notes

- Project identifiers can be numeric IDs or URL-encoded paths (e.g., `group%2Fproject`)
- Use URL-encoded paths for nested groups: `group%2Fsubgroup%2Fproject`
