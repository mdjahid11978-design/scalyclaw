// gitlab-skill — GitLab REST API v4 via fetch()

const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const BASE_URL = (process.env.GITLAB_BASE_URL || 'https://gitlab.com/api/v4').replace(/\/$/, '');

if (!GITLAB_TOKEN) {
  console.error('GITLAB_TOKEN is required');
  console.log(JSON.stringify({ error: 'GITLAB_TOKEN secret is not configured' }));
  process.exit(0);
}

interface ApiResult {
  data: any;
  pagination: { total?: string; next_page?: string; prev_page?: string; total_pages?: string };
}

async function gitlabApi(method: string, path: string, body?: any, query?: Record<string, string>): Promise<ApiResult> {
  let url = `${BASE_URL}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    'PRIVATE-TOKEN': GITLAB_TOKEN!,
  };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const pagination = {
    total: res.headers.get('x-total') || undefined,
    next_page: res.headers.get('x-next-page') || undefined,
    prev_page: res.headers.get('x-prev-page') || undefined,
    total_pages: res.headers.get('x-total-pages') || undefined,
  };

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitLab API ${res.status}: ${errBody}`);
  }

  if (res.status === 204) return { data: null, pagination };

  const data = await res.json();
  return { data, pagination };
}

// URL-encode project identifier (e.g. "group/project" → "group%2Fproject")
function encProject(project: string | number): string {
  if (typeof project === 'number') return String(project);
  return encodeURIComponent(String(project));
}

function q(input: any, keys: string[]): Record<string, string> {
  const query: Record<string, string> = {};
  for (const k of keys) {
    if (input[k] !== undefined) query[k] = String(input[k]);
  }
  return query;
}

type Handler = (input: any) => Promise<any>;

const ACTIONS: Record<string, Handler> = {
  // ── Projects ──
  async project_get(input) {
    if (!input.project) throw new Error('Missing required field: project');
    return gitlabApi('GET', `/projects/${encProject(input.project)}`);
  },
  async project_list(input) {
    return gitlabApi('GET', '/projects', undefined, q(input, ['owned', 'membership', 'search', 'per_page', 'page']));
  },
  async project_create(input) {
    if (!input.name) throw new Error('Missing required field: name');
    return gitlabApi('POST', '/projects', {
      name: input.name, description: input.description,
      visibility: input.visibility || 'private',
      initialize_with_readme: input.initialize_with_readme,
    });
  },
  async project_delete(input) {
    if (!input.project) throw new Error('Missing required field: project');
    return gitlabApi('DELETE', `/projects/${encProject(input.project)}`);
  },
  async project_members(input) {
    if (!input.project) throw new Error('Missing required field: project');
    return gitlabApi('GET', `/projects/${encProject(input.project)}/members`, undefined, q(input, ['per_page', 'page']));
  },

  // ── Issues ──
  async issue_list(input) {
    if (!input.project) throw new Error('Missing required field: project');
    return gitlabApi('GET', `/projects/${encProject(input.project)}/issues`,
      undefined, q(input, ['state', 'labels', 'assignee_username', 'per_page', 'page']));
  },
  async issue_get(input) {
    if (!input.project || !input.iid) throw new Error('Missing required fields: project, iid');
    return gitlabApi('GET', `/projects/${encProject(input.project)}/issues/${input.iid}`);
  },
  async issue_create(input) {
    if (!input.project || !input.title) throw new Error('Missing required fields: project, title');
    return gitlabApi('POST', `/projects/${encProject(input.project)}/issues`, {
      title: input.title, description: input.description,
      labels: input.labels, assignee_ids: input.assignee_ids,
    });
  },
  async issue_update(input) {
    if (!input.project || !input.iid) throw new Error('Missing required fields: project, iid');
    const body: any = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.description !== undefined) body.description = input.description;
    if (input.state_event !== undefined) body.state_event = input.state_event;
    if (input.labels !== undefined) body.labels = input.labels;
    if (input.assignee_ids !== undefined) body.assignee_ids = input.assignee_ids;
    return gitlabApi('PUT', `/projects/${encProject(input.project)}/issues/${input.iid}`, body);
  },
  async issue_notes(input) {
    if (!input.project || !input.iid) throw new Error('Missing required fields: project, iid');
    if (input.body) {
      return gitlabApi('POST', `/projects/${encProject(input.project)}/issues/${input.iid}/notes`, { body: input.body });
    }
    return gitlabApi('GET', `/projects/${encProject(input.project)}/issues/${input.iid}/notes`);
  },

  // ── Merge Requests ──
  async mr_list(input) {
    if (!input.project) throw new Error('Missing required field: project');
    return gitlabApi('GET', `/projects/${encProject(input.project)}/merge_requests`,
      undefined, q(input, ['state', 'source_branch', 'target_branch', 'per_page', 'page']));
  },
  async mr_get(input) {
    if (!input.project || !input.iid) throw new Error('Missing required fields: project, iid');
    return gitlabApi('GET', `/projects/${encProject(input.project)}/merge_requests/${input.iid}`);
  },
  async mr_create(input) {
    if (!input.project || !input.title || !input.source_branch || !input.target_branch)
      throw new Error('Missing required fields: project, title, source_branch, target_branch');
    return gitlabApi('POST', `/projects/${encProject(input.project)}/merge_requests`, {
      title: input.title, source_branch: input.source_branch, target_branch: input.target_branch,
      description: input.description,
    });
  },
  async mr_update(input) {
    if (!input.project || !input.iid) throw new Error('Missing required fields: project, iid');
    const body: any = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.description !== undefined) body.description = input.description;
    if (input.state_event !== undefined) body.state_event = input.state_event;
    if (input.target_branch !== undefined) body.target_branch = input.target_branch;
    return gitlabApi('PUT', `/projects/${encProject(input.project)}/merge_requests/${input.iid}`, body);
  },
  async mr_merge(input) {
    if (!input.project || !input.iid) throw new Error('Missing required fields: project, iid');
    const body: any = {};
    if (input.merge_when_pipeline_succeeds) body.merge_when_pipeline_succeeds = true;
    if (input.squash) body.squash = true;
    return gitlabApi('PUT', `/projects/${encProject(input.project)}/merge_requests/${input.iid}/merge`, body);
  },
  async mr_approve(input) {
    if (!input.project || !input.iid) throw new Error('Missing required fields: project, iid');
    return gitlabApi('POST', `/projects/${encProject(input.project)}/merge_requests/${input.iid}/approve`);
  },
  async mr_changes(input) {
    if (!input.project || !input.iid) throw new Error('Missing required fields: project, iid');
    return gitlabApi('GET', `/projects/${encProject(input.project)}/merge_requests/${input.iid}/changes`);
  },
  async mr_notes(input) {
    if (!input.project || !input.iid) throw new Error('Missing required fields: project, iid');
    if (input.body) {
      return gitlabApi('POST', `/projects/${encProject(input.project)}/merge_requests/${input.iid}/notes`, { body: input.body });
    }
    return gitlabApi('GET', `/projects/${encProject(input.project)}/merge_requests/${input.iid}/notes`);
  },

  // ── Branches ──
  async branch_list(input) {
    if (!input.project) throw new Error('Missing required field: project');
    return gitlabApi('GET', `/projects/${encProject(input.project)}/repository/branches`,
      undefined, q(input, ['search', 'per_page', 'page']));
  },
  async branch_get(input) {
    if (!input.project || !input.branch) throw new Error('Missing required fields: project, branch');
    return gitlabApi('GET', `/projects/${encProject(input.project)}/repository/branches/${encodeURIComponent(input.branch)}`);
  },
  async branch_create(input) {
    if (!input.project || !input.branch || !input.ref) throw new Error('Missing required fields: project, branch, ref');
    return gitlabApi('POST', `/projects/${encProject(input.project)}/repository/branches`, undefined, {
      branch: input.branch, ref: input.ref,
    });
  },
  async branch_delete(input) {
    if (!input.project || !input.branch) throw new Error('Missing required fields: project, branch');
    return gitlabApi('DELETE', `/projects/${encProject(input.project)}/repository/branches/${encodeURIComponent(input.branch)}`);
  },
  async branch_protect(input) {
    if (!input.project || !input.branch) throw new Error('Missing required fields: project, branch');
    const body: any = { name: input.branch };
    if (input.push_access_level !== undefined) body.push_access_level = input.push_access_level;
    if (input.merge_access_level !== undefined) body.merge_access_level = input.merge_access_level;
    return gitlabApi('POST', `/projects/${encProject(input.project)}/protected_branches`, body);
  },

  // ── Pipelines ──
  async pipeline_list(input) {
    if (!input.project) throw new Error('Missing required field: project');
    return gitlabApi('GET', `/projects/${encProject(input.project)}/pipelines`,
      undefined, q(input, ['ref', 'status', 'per_page', 'page']));
  },
  async pipeline_get(input) {
    if (!input.project || !input.pipeline_id) throw new Error('Missing required fields: project, pipeline_id');
    return gitlabApi('GET', `/projects/${encProject(input.project)}/pipelines/${input.pipeline_id}`);
  },
  async pipeline_create(input) {
    if (!input.project || !input.ref) throw new Error('Missing required fields: project, ref');
    const body: any = { ref: input.ref };
    if (input.variables) body.variables = input.variables;
    return gitlabApi('POST', `/projects/${encProject(input.project)}/pipeline`, body);
  },
  async pipeline_cancel(input) {
    if (!input.project || !input.pipeline_id) throw new Error('Missing required fields: project, pipeline_id');
    return gitlabApi('POST', `/projects/${encProject(input.project)}/pipelines/${input.pipeline_id}/cancel`);
  },
  async pipeline_retry(input) {
    if (!input.project || !input.pipeline_id) throw new Error('Missing required fields: project, pipeline_id');
    return gitlabApi('POST', `/projects/${encProject(input.project)}/pipelines/${input.pipeline_id}/retry`);
  },
  async pipeline_jobs(input) {
    if (!input.project || !input.pipeline_id) throw new Error('Missing required fields: project, pipeline_id');
    return gitlabApi('GET', `/projects/${encProject(input.project)}/pipelines/${input.pipeline_id}/jobs`,
      undefined, q(input, ['per_page']));
  },
  async job_log(input) {
    if (!input.project || !input.job_id) throw new Error('Missing required fields: project, job_id');
    const p = encProject(input.project);
    const url = `${BASE_URL}/projects/${p}/jobs/${input.job_id}/trace`;
    const res = await fetch(url, { headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN! } });
    if (!res.ok) throw new Error(`GitLab API ${res.status}: ${await res.text()}`);
    return { data: { log: await res.text() }, pagination: {} };
  },

  // ── Releases ──
  async release_list(input) {
    if (!input.project) throw new Error('Missing required field: project');
    return gitlabApi('GET', `/projects/${encProject(input.project)}/releases`, undefined, q(input, ['per_page']));
  },
  async release_create(input) {
    if (!input.project || !input.tag_name) throw new Error('Missing required fields: project, tag_name');
    return gitlabApi('POST', `/projects/${encProject(input.project)}/releases`, {
      tag_name: input.tag_name, name: input.name, description: input.description, ref: input.ref,
    });
  },

  // ── Files ──
  async file_get(input) {
    if (!input.project || !input.path) throw new Error('Missing required fields: project, path');
    const filePath = encodeURIComponent(input.path);
    const query: Record<string, string> = { ref: input.ref || 'main' };
    return gitlabApi('GET', `/projects/${encProject(input.project)}/repository/files/${filePath}`, undefined, query);
  },
  async file_create_or_update(input) {
    if (!input.project || !input.path || !input.content || !input.branch || !input.commit_message)
      throw new Error('Missing required fields: project, path, content, branch, commit_message');
    const filePath = encodeURIComponent(input.path);
    const body: any = {
      branch: input.branch, content: input.content, commit_message: input.commit_message,
    };
    if (input.encoding) body.encoding = input.encoding;
    // Try PUT (update) first, if 404 do POST (create)
    try {
      return await gitlabApi('PUT', `/projects/${encProject(input.project)}/repository/files/${filePath}`, body);
    } catch (e: any) {
      if (e.message.includes('404')) {
        return gitlabApi('POST', `/projects/${encProject(input.project)}/repository/files/${filePath}`, body);
      }
      throw e;
    }
  },

  // ── Other ──
  async user_get() {
    return gitlabApi('GET', '/user');
  },
  async group_list(input) {
    return gitlabApi('GET', '/groups', undefined, q(input, ['search', 'per_page', 'page']));
  },
  async search(input) {
    if (!input.scope || !input.search) throw new Error('Missing required fields: scope, search');
    if (input.project) {
      return gitlabApi('GET', `/projects/${encProject(input.project)}/search`, undefined, {
        scope: input.scope, search: input.search,
      });
    }
    return gitlabApi('GET', '/search', undefined, { scope: input.scope, search: input.search });
  },
};

// ── Entry Point ──
try {
  const input = await Bun.stdin.json();
  const action = input.action;
  if (!action) throw new Error('Missing required field: action');
  const handler = ACTIONS[action];
  if (!handler) throw new Error(`Unknown action: ${action}. Valid: ${Object.keys(ACTIONS).join(', ')}`);
  const result = await handler(input);
  console.log(JSON.stringify(result));
} catch (err: any) {
  console.error(err.message);
  console.log(JSON.stringify({ error: err.message }));
}
