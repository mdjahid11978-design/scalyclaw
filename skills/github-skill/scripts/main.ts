// github-skill — GitHub REST API v3 via fetch()

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const BASE_URL = (process.env.GITHUB_BASE_URL || 'https://api.github.com').replace(/\/$/, '');

if (!GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN is required');
  console.log(JSON.stringify({ error: 'GITHUB_TOKEN secret is not configured' }));
  process.exit(0);
}

interface ApiResult {
  data: any;
  pagination: Record<string, string>;
  rateLimit: { remaining: number; reset: string };
}

async function githubApi(method: string, path: string, body?: any, query?: Record<string, string>): Promise<ApiResult> {
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
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Parse pagination from Link header
  const pagination: Record<string, string> = {};
  const link = res.headers.get('link');
  if (link) {
    for (const part of link.split(',')) {
      const match = part.match(/<([^>]+)>;\s*rel="(\w+)"/);
      if (match) pagination[match[2]] = match[1];
    }
  }

  const rateLimit = {
    remaining: parseInt(res.headers.get('x-ratelimit-remaining') || '-1'),
    reset: new Date(parseInt(res.headers.get('x-ratelimit-reset') || '0') * 1000).toISOString(),
  };

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub API ${res.status}: ${errBody}`);
  }

  // Some endpoints return 204 No Content
  if (res.status === 204) return { data: null, pagination, rateLimit };

  const data = await res.json();
  return { data, pagination, rateLimit };
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
  // ── Repos ──
  async repo_get(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}`);
  },
  async repo_list(input) {
    const path = input.owner ? `/users/${input.owner}/repos` : '/user/repos';
    return githubApi('GET', path, undefined, q(input, ['per_page', 'page', 'type', 'sort']));
  },
  async repo_create(input) {
    if (!input.name) throw new Error('Missing required field: name');
    return githubApi('POST', '/user/repos', {
      name: input.name,
      description: input.description,
      private: input.private ?? true,
      auto_init: input.auto_init,
    });
  },
  async repo_delete(input) {
    return githubApi('DELETE', `/repos/${input.owner}/${input.repo}`);
  },
  async repo_topics(input) {
    if (input.names) {
      return githubApi('PUT', `/repos/${input.owner}/${input.repo}/topics`, { names: input.names });
    }
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/topics`);
  },
  async repo_collaborators(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/collaborators`);
  },

  // ── Issues ──
  async issue_list(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/issues`,
      undefined, q(input, ['state', 'labels', 'assignee', 'per_page', 'page']));
  },
  async issue_get(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/issues/${input.number}`);
  },
  async issue_create(input) {
    if (!input.title) throw new Error('Missing required field: title');
    return githubApi('POST', `/repos/${input.owner}/${input.repo}/issues`, {
      title: input.title, body: input.body, labels: input.labels, assignees: input.assignees,
    });
  },
  async issue_update(input) {
    const body: any = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.body !== undefined) body.body = input.body;
    if (input.state !== undefined) body.state = input.state;
    if (input.labels !== undefined) body.labels = input.labels;
    if (input.assignees !== undefined) body.assignees = input.assignees;
    return githubApi('PATCH', `/repos/${input.owner}/${input.repo}/issues/${input.number}`, body);
  },
  async issue_comments(input) {
    if (input.body) {
      return githubApi('POST', `/repos/${input.owner}/${input.repo}/issues/${input.number}/comments`, { body: input.body });
    }
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/issues/${input.number}/comments`);
  },

  // ── Pull Requests ──
  async pr_list(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/pulls`,
      undefined, q(input, ['state', 'head', 'base', 'per_page', 'page']));
  },
  async pr_get(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/pulls/${input.number}`);
  },
  async pr_create(input) {
    if (!input.title || !input.head || !input.base) throw new Error('Missing required fields: title, head, base');
    return githubApi('POST', `/repos/${input.owner}/${input.repo}/pulls`, {
      title: input.title, head: input.head, base: input.base, body: input.body, draft: input.draft,
    });
  },
  async pr_update(input) {
    const body: any = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.body !== undefined) body.body = input.body;
    if (input.state !== undefined) body.state = input.state;
    if (input.base !== undefined) body.base = input.base;
    return githubApi('PATCH', `/repos/${input.owner}/${input.repo}/pulls/${input.number}`, body);
  },
  async pr_merge(input) {
    const body: any = {};
    if (input.merge_method) body.merge_method = input.merge_method;
    if (input.commit_title) body.commit_title = input.commit_title;
    return githubApi('PUT', `/repos/${input.owner}/${input.repo}/pulls/${input.number}/merge`, body);
  },
  async pr_reviews(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/pulls/${input.number}/reviews`);
  },
  async pr_files(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/pulls/${input.number}/files`);
  },
  async pr_diff(input) {
    const url = `${BASE_URL}/repos/${input.owner}/${input.repo}/pulls/${input.number}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3.diff',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    return { data: await res.text(), pagination: {}, rateLimit: { remaining: -1, reset: '' } };
  },

  // ── Branches ──
  async branch_list(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/branches`,
      undefined, q(input, ['per_page', 'page']));
  },
  async branch_get(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/branches/${input.branch}`);
  },
  async branch_protection(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/branches/${input.branch}/protection`);
  },

  // ── Releases ──
  async release_list(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/releases`,
      undefined, q(input, ['per_page']));
  },
  async release_get(input) {
    const path = input.tag
      ? `/repos/${input.owner}/${input.repo}/releases/tags/${input.tag}`
      : `/repos/${input.owner}/${input.repo}/releases/latest`;
    return githubApi('GET', path);
  },
  async release_create(input) {
    if (!input.tag_name) throw new Error('Missing required field: tag_name');
    return githubApi('POST', `/repos/${input.owner}/${input.repo}/releases`, {
      tag_name: input.tag_name, name: input.name, body: input.body,
      draft: input.draft, prerelease: input.prerelease, target_commitish: input.target_commitish,
    });
  },

  // ── Actions / CI ──
  async workflow_list(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/actions/workflows`);
  },
  async workflow_runs(input) {
    const path = input.workflow_id
      ? `/repos/${input.owner}/${input.repo}/actions/workflows/${input.workflow_id}/runs`
      : `/repos/${input.owner}/${input.repo}/actions/runs`;
    return githubApi('GET', path, undefined, q(input, ['status', 'branch', 'per_page']));
  },
  async workflow_dispatch(input) {
    if (!input.workflow_id || !input.ref) throw new Error('Missing required fields: workflow_id, ref');
    return githubApi('POST', `/repos/${input.owner}/${input.repo}/actions/workflows/${input.workflow_id}/dispatches`, {
      ref: input.ref, inputs: input.inputs || {},
    });
  },
  async run_get(input) {
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/actions/runs/${input.run_id}`);
  },
  async run_logs(input) {
    // This returns a redirect to a zip — we'll return the URL
    const url = `${BASE_URL}/repos/${input.owner}/${input.repo}/actions/runs/${input.run_id}/logs`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'manual',
    });
    const location = res.headers.get('location');
    if (location) return { data: { logs_url: location }, pagination: {}, rateLimit: { remaining: -1, reset: '' } };
    throw new Error(`GitHub API ${res.status}: could not get logs URL`);
  },
  async run_cancel(input) {
    return githubApi('POST', `/repos/${input.owner}/${input.repo}/actions/runs/${input.run_id}/cancel`);
  },
  async run_rerun(input) {
    return githubApi('POST', `/repos/${input.owner}/${input.repo}/actions/runs/${input.run_id}/rerun`);
  },

  // ── Gists ──
  async gist_list(input) {
    return githubApi('GET', '/gists', undefined, q(input, ['per_page', 'page']));
  },
  async gist_get(input) {
    if (!input.gist_id) throw new Error('Missing required field: gist_id');
    return githubApi('GET', `/gists/${input.gist_id}`);
  },
  async gist_create(input) {
    if (!input.files) throw new Error('Missing required field: files');
    return githubApi('POST', '/gists', {
      description: input.description, files: input.files, public: input.public ?? false,
    });
  },
  async gist_update(input) {
    if (!input.gist_id) throw new Error('Missing required field: gist_id');
    const body: any = { files: input.files };
    if (input.description !== undefined) body.description = input.description;
    return githubApi('PATCH', `/gists/${input.gist_id}`, body);
  },

  // ── Content ──
  async content_get(input) {
    const query: Record<string, string> = {};
    if (input.ref) query.ref = input.ref;
    return githubApi('GET', `/repos/${input.owner}/${input.repo}/contents/${input.path}`, undefined, query);
  },
  async content_create_or_update(input) {
    if (!input.path || !input.message || !input.content) throw new Error('Missing required fields: path, message, content');
    const body: any = {
      message: input.message,
      content: btoa(input.content),
    };
    if (input.sha) body.sha = input.sha;
    if (input.branch) body.branch = input.branch;
    return githubApi('PUT', `/repos/${input.owner}/${input.repo}/contents/${input.path}`, body);
  },

  // ── Other ──
  async user_get(input) {
    const path = input.username ? `/users/${input.username}` : '/user';
    return githubApi('GET', path);
  },
  async search(input) {
    if (!input.type || !input.q) throw new Error('Missing required fields: type, q');
    return githubApi('GET', `/search/${input.type}`, undefined, q(input, ['q', 'per_page', 'page']));
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
