// bitbucket-skill — Bitbucket REST API 2.0 via fetch()

const BB_USERNAME = process.env.BITBUCKET_USERNAME;
const BB_APP_PASSWORD = process.env.BITBUCKET_APP_PASSWORD;
const BASE_URL = (process.env.BITBUCKET_BASE_URL || 'https://api.bitbucket.org/2.0').replace(/\/$/, '');

if (!BB_USERNAME || !BB_APP_PASSWORD) {
  console.error('BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD are required');
  console.log(JSON.stringify({ error: 'BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD secrets are not configured' }));
  process.exit(0);
}

const AUTH_HEADER = `Basic ${btoa(`${BB_USERNAME}:${BB_APP_PASSWORD}`)}`;

interface ApiResult {
  data: any;
  pagination: { next?: string; previous?: string };
}

async function bitbucketApi(method: string, path: string, body?: any, query?: Record<string, string>): Promise<ApiResult> {
  let url = `${BASE_URL}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  const headers: Record<string, string> = {
    'Authorization': AUTH_HEADER,
  };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Bitbucket API ${res.status}: ${errBody}`);
  }

  if (res.status === 204) return { data: null, pagination: {} };

  // Some responses (like diffs) return plain text
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    return { data: await res.text(), pagination: {} };
  }

  const data = await res.json();
  return {
    data,
    pagination: { next: data.next, previous: data.previous },
  };
}

function repo(input: any): string {
  if (!input.workspace || !input.repo_slug) throw new Error('Missing required fields: workspace, repo_slug');
  return `/repositories/${input.workspace}/${input.repo_slug}`;
}

function q(input: any, keys: string[]): Record<string, string> {
  const query: Record<string, string> = {};
  for (const k of keys) {
    if (input[k] !== undefined) query[k] = String(input[k]);
  }
  return query;
}

// Bitbucket uses "pagelen" instead of "per_page" and "page" for pagination
function pq(input: any): Record<string, string> {
  const query: Record<string, string> = {};
  if (input.per_page) query.pagelen = String(input.per_page);
  if (input.page) query.page = String(input.page);
  return query;
}

type Handler = (input: any) => Promise<any>;

const ACTIONS: Record<string, Handler> = {
  // ── Repos ──
  async repo_get(input) {
    return bitbucketApi('GET', repo(input));
  },
  async repo_list(input) {
    if (!input.workspace) throw new Error('Missing required field: workspace');
    return bitbucketApi('GET', `/repositories/${input.workspace}`, undefined, pq(input));
  },
  async repo_create(input) {
    if (!input.workspace || !input.repo_slug) throw new Error('Missing required fields: workspace, repo_slug');
    return bitbucketApi('POST', repo(input), {
      scm: input.scm || 'git',
      description: input.description,
      is_private: input.is_private ?? true,
    });
  },
  async repo_delete(input) {
    return bitbucketApi('DELETE', repo(input));
  },
  async repo_forks(input) {
    return bitbucketApi('GET', `${repo(input)}/forks`, undefined, pq(input));
  },

  // ── Pull Requests ──
  async pr_list(input) {
    const query = { ...pq(input), ...q(input, ['state']) };
    return bitbucketApi('GET', `${repo(input)}/pullrequests`, undefined, query);
  },
  async pr_get(input) {
    if (!input.pr_id) throw new Error('Missing required field: pr_id');
    return bitbucketApi('GET', `${repo(input)}/pullrequests/${input.pr_id}`);
  },
  async pr_create(input) {
    if (!input.title || !input.source_branch) throw new Error('Missing required fields: title, source_branch');
    const body: any = {
      title: input.title,
      source: { branch: { name: input.source_branch } },
      description: input.description,
      close_source_branch: input.close_source_branch ?? false,
    };
    if (input.destination_branch) {
      body.destination = { branch: { name: input.destination_branch } };
    }
    return bitbucketApi('POST', `${repo(input)}/pullrequests`, body);
  },
  async pr_update(input) {
    if (!input.pr_id) throw new Error('Missing required field: pr_id');
    const body: any = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.description !== undefined) body.description = input.description;
    return bitbucketApi('PUT', `${repo(input)}/pullrequests/${input.pr_id}`, body);
  },
  async pr_merge(input) {
    if (!input.pr_id) throw new Error('Missing required field: pr_id');
    const body: any = {};
    if (input.merge_strategy) body.merge_strategy = input.merge_strategy;
    if (input.close_source_branch !== undefined) body.close_source_branch = input.close_source_branch;
    return bitbucketApi('POST', `${repo(input)}/pullrequests/${input.pr_id}/merge`, body);
  },
  async pr_approve(input) {
    if (!input.pr_id) throw new Error('Missing required field: pr_id');
    return bitbucketApi('POST', `${repo(input)}/pullrequests/${input.pr_id}/approve`);
  },
  async pr_decline(input) {
    if (!input.pr_id) throw new Error('Missing required field: pr_id');
    return bitbucketApi('POST', `${repo(input)}/pullrequests/${input.pr_id}/decline`);
  },
  async pr_diff(input) {
    if (!input.pr_id) throw new Error('Missing required field: pr_id');
    return bitbucketApi('GET', `${repo(input)}/pullrequests/${input.pr_id}/diff`);
  },
  async pr_comments(input) {
    if (!input.pr_id) throw new Error('Missing required field: pr_id');
    if (input.body) {
      return bitbucketApi('POST', `${repo(input)}/pullrequests/${input.pr_id}/comments`, {
        content: { raw: input.body },
      });
    }
    return bitbucketApi('GET', `${repo(input)}/pullrequests/${input.pr_id}/comments`);
  },
  async pr_activity(input) {
    if (!input.pr_id) throw new Error('Missing required field: pr_id');
    return bitbucketApi('GET', `${repo(input)}/pullrequests/${input.pr_id}/activity`);
  },

  // ── Branches & Tags ──
  async branch_list(input) {
    return bitbucketApi('GET', `${repo(input)}/refs/branches`, undefined, pq(input));
  },
  async branch_create(input) {
    if (!input.name || !input.target) throw new Error('Missing required fields: name, target');
    return bitbucketApi('POST', `${repo(input)}/refs/branches`, {
      name: input.name,
      target: { hash: input.target },
    });
  },
  async branch_delete(input) {
    if (!input.name) throw new Error('Missing required field: name');
    return bitbucketApi('DELETE', `${repo(input)}/refs/branches/${encodeURIComponent(input.name)}`);
  },
  async tag_list(input) {
    return bitbucketApi('GET', `${repo(input)}/refs/tags`, undefined, pq(input));
  },
  async tag_create(input) {
    if (!input.name || !input.target) throw new Error('Missing required fields: name, target');
    const body: any = {
      name: input.name,
      target: { hash: input.target },
    };
    if (input.message) body.message = input.message;
    return bitbucketApi('POST', `${repo(input)}/refs/tags`, body);
  },

  // ── Issues ──
  async issue_list(input) {
    return bitbucketApi('GET', `${repo(input)}/issues`, undefined, { ...pq(input), ...q(input, ['state']) });
  },
  async issue_get(input) {
    if (!input.issue_id) throw new Error('Missing required field: issue_id');
    return bitbucketApi('GET', `${repo(input)}/issues/${input.issue_id}`);
  },
  async issue_create(input) {
    if (!input.title) throw new Error('Missing required field: title');
    const body: any = { title: input.title };
    if (input.content) body.content = { raw: input.content };
    if (input.kind) body.kind = input.kind;
    if (input.priority) body.priority = input.priority;
    return bitbucketApi('POST', `${repo(input)}/issues`, body);
  },
  async issue_update(input) {
    if (!input.issue_id) throw new Error('Missing required field: issue_id');
    const body: any = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.content !== undefined) body.content = { raw: input.content };
    if (input.state !== undefined) body.state = input.state;
    if (input.kind !== undefined) body.kind = input.kind;
    if (input.priority !== undefined) body.priority = input.priority;
    return bitbucketApi('PUT', `${repo(input)}/issues/${input.issue_id}`, body);
  },

  // ── Pipelines ──
  async pipeline_list(input) {
    return bitbucketApi('GET', `${repo(input)}/pipelines/`, undefined, pq(input));
  },
  async pipeline_get(input) {
    if (!input.pipeline_uuid) throw new Error('Missing required field: pipeline_uuid');
    return bitbucketApi('GET', `${repo(input)}/pipelines/${input.pipeline_uuid}`);
  },
  async pipeline_trigger(input) {
    if (!input.target_branch) throw new Error('Missing required field: target_branch');
    const body: any = {
      target: {
        type: 'pipeline_ref_target',
        ref_type: 'branch',
        ref_name: input.target_branch,
      },
    };
    if (input.variables) {
      body.variables = input.variables.map((v: any) => ({
        key: v.key, value: v.value, secured: v.secured ?? false,
      }));
    }
    return bitbucketApi('POST', `${repo(input)}/pipelines/`, body);
  },
  async pipeline_stop(input) {
    if (!input.pipeline_uuid) throw new Error('Missing required field: pipeline_uuid');
    return bitbucketApi('POST', `${repo(input)}/pipelines/${input.pipeline_uuid}/stopPipeline`);
  },
  async pipeline_steps(input) {
    if (!input.pipeline_uuid) throw new Error('Missing required field: pipeline_uuid');
    return bitbucketApi('GET', `${repo(input)}/pipelines/${input.pipeline_uuid}/steps/`);
  },
  async step_log(input) {
    if (!input.pipeline_uuid || !input.step_uuid) throw new Error('Missing required fields: pipeline_uuid, step_uuid');
    return bitbucketApi('GET', `${repo(input)}/pipelines/${input.pipeline_uuid}/steps/${input.step_uuid}/log`);
  },

  // ── Content ──
  async src_get(input) {
    if (!input.path) throw new Error('Missing required field: path');
    const ref = input.ref || 'main';
    return bitbucketApi('GET', `${repo(input)}/src/${encodeURIComponent(ref)}/${input.path}`);
  },
  async src_list(input) {
    const ref = input.ref || 'main';
    const path = input.path || '';
    return bitbucketApi('GET', `${repo(input)}/src/${encodeURIComponent(ref)}/${path}`);
  },

  // ── Other ──
  async user_get() {
    return bitbucketApi('GET', '/user');
  },
  async workspace_list(input) {
    return bitbucketApi('GET', '/workspaces', undefined, pq(input));
  },
  async workspace_members(input) {
    if (!input.workspace) throw new Error('Missing required field: workspace');
    return bitbucketApi('GET', `/workspaces/${input.workspace}/members`, undefined, pq(input));
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
