// git-skill — Complete local + remote git operations via Bun.spawn

const GIT_USERNAME = process.env.GIT_USERNAME;
const GIT_EMAIL = process.env.GIT_EMAIL;
const GIT_PASSWORD = process.env.GIT_PASSWORD;

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runGit(args: string[], cwd?: string): Promise<RunResult> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (GIT_USERNAME) {
    env.GIT_AUTHOR_NAME = GIT_USERNAME;
    env.GIT_COMMITTER_NAME = GIT_USERNAME;
  }
  if (GIT_EMAIL) {
    env.GIT_AUTHOR_EMAIL = GIT_EMAIL;
    env.GIT_COMMITTER_EMAIL = GIT_EMAIL;
  }
  // For authenticated HTTPS operations, use GIT_ASKPASS
  if (GIT_PASSWORD) {
    const script = `#!/bin/sh\necho "${GIT_PASSWORD}"`;
    const tmpFile = `/tmp/.git-askpass-${Date.now()}.sh`;
    await Bun.write(tmpFile, script);
    const { exited: chmodDone } = Bun.spawn(['chmod', '+x', tmpFile]);
    await chmodDone;
    env.GIT_ASKPASS = tmpFile;
    env.GIT_TERMINAL_PROMPT = '0';
  }

  const proc = Bun.spawn(['git', ...args], {
    cwd: cwd || process.cwd(),
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  // Cleanup askpass script
  if (env.GIT_ASKPASS?.startsWith('/tmp/.git-askpass-')) {
    try { await Bun.spawn(['rm', '-f', env.GIT_ASKPASS]).exited; } catch {}
  }

  if (exitCode !== 0) {
    throw new Error(`git ${args[0]} failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`);
  }
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

type Handler = (input: any) => Promise<any>;

const ACTIONS: Record<string, Handler> = {
  // ── Repository ──
  async init(input) {
    const args = ['init'];
    if (input.path) args.push(input.path);
    const r = await runGit(args, input.cwd);
    return { message: r.stdout };
  },

  async clone(input) {
    if (!input.url) throw new Error('Missing required field: url');
    const args = ['clone'];
    if (input.depth) args.push('--depth', String(input.depth));
    if (input.branch) args.push('--branch', input.branch);
    args.push(input.url);
    if (input.path) args.push(input.path);
    const r = await runGit(args, input.cwd);
    return { message: r.stderr || r.stdout };
  },

  async config(input) {
    if (!input.key) throw new Error('Missing required field: key');
    const args = ['config'];
    if (input.global) args.push('--global');
    args.push(input.key);
    if (input.value !== undefined) {
      args.push(input.value);
      await runGit(args, input.cwd);
      return { key: input.key, value: input.value };
    }
    const r = await runGit(args, input.cwd);
    return { key: input.key, value: r.stdout };
  },

  // ── Staging & Commits ──
  async status(input) {
    const r = await runGit(['status', '--porcelain=v1', '-b'], input.cwd);
    const lines = r.stdout.split('\n').filter(Boolean);
    const branchLine = lines.find(l => l.startsWith('##'));
    const branch = branchLine ? branchLine.replace('## ', '').split('...')[0] : 'unknown';
    const staged: string[] = [], modified: string[] = [], untracked: string[] = [];
    for (const line of lines) {
      if (line.startsWith('##')) continue;
      const x = line[0], y = line[1], file = line.slice(3);
      if (x !== ' ' && x !== '?') staged.push(file);
      if (y === 'M' || y === 'D') modified.push(file);
      if (x === '?') untracked.push(file);
    }
    return { branch, clean: staged.length === 0 && modified.length === 0 && untracked.length === 0, staged, modified, untracked };
  },

  async add(input) {
    if (!input.files) throw new Error('Missing required field: files');
    const files = Array.isArray(input.files) ? input.files : [input.files];
    await runGit(['add', ...files], input.cwd);
    return { added: files };
  },

  async reset_stage(input) {
    const args = ['reset', 'HEAD'];
    if (input.files) {
      const files = Array.isArray(input.files) ? input.files : [input.files];
      args.push('--', ...files);
    }
    await runGit(args, input.cwd);
    return { message: 'Unstaged successfully' };
  },

  async commit(input) {
    if (!input.message) throw new Error('Missing required field: message');
    const args = ['commit', '-m', input.message];
    if (input.all) args.splice(1, 0, '-a');
    const r = await runGit(args, input.cwd);
    // Parse the commit hash from output
    const match = r.stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
    return { message: r.stdout, hash: match ? match[1] : null };
  },

  async cherry_pick(input) {
    if (!input.commits) throw new Error('Missing required field: commits');
    const commits = Array.isArray(input.commits) ? input.commits : [input.commits];
    const r = await runGit(['cherry-pick', ...commits], input.cwd);
    return { message: r.stdout };
  },

  async revert(input) {
    if (!input.commit) throw new Error('Missing required field: commit');
    const r = await runGit(['revert', '--no-edit', input.commit], input.cwd);
    return { message: r.stdout };
  },

  // ── Branching ──
  async branches(input) {
    const args = ['branch'];
    if (input.all) args.push('-a');
    else if (input.remote) args.push('-r');
    args.push('--format=%(refname:short)\t%(HEAD)');
    const r = await runGit(args, input.cwd);
    const branches: string[] = [];
    let current = '';
    for (const line of r.stdout.split('\n').filter(Boolean)) {
      const [name, head] = line.split('\t');
      branches.push(name);
      if (head === '*') current = name;
    }
    // Fallback: get current branch separately if format didn't capture it
    if (!current) {
      try {
        const c = await runGit(['branch', '--show-current'], input.cwd);
        current = c.stdout;
      } catch {}
    }
    return { current, branches };
  },

  async branch_create(input) {
    if (!input.name) throw new Error('Missing required field: name');
    const args = ['branch', input.name];
    if (input.start_point) args.push(input.start_point);
    await runGit(args, input.cwd);
    return { created: input.name };
  },

  async branch_delete(input) {
    if (!input.name) throw new Error('Missing required field: name');
    await runGit(['branch', input.force ? '-D' : '-d', input.name], input.cwd);
    return { deleted: input.name };
  },

  async branch_rename(input) {
    if (!input.old_name || !input.new_name) throw new Error('Missing required fields: old_name, new_name');
    await runGit(['branch', '-m', input.old_name, input.new_name], input.cwd);
    return { renamed: { from: input.old_name, to: input.new_name } };
  },

  async checkout(input) {
    if (!input.ref) throw new Error('Missing required field: ref');
    const args = ['checkout'];
    if (input.create) args.push('-b');
    args.push(input.ref);
    const r = await runGit(args, input.cwd);
    return { message: r.stderr || r.stdout, ref: input.ref };
  },

  async switch(input) {
    if (!input.branch) throw new Error('Missing required field: branch');
    const args = ['switch'];
    if (input.create) args.push('-c');
    args.push(input.branch);
    const r = await runGit(args, input.cwd);
    return { message: r.stderr || r.stdout, branch: input.branch };
  },

  // ── Remote ──
  async remote_list(input) {
    const r = await runGit(['remote', '-v'], input.cwd);
    const remotes: Record<string, { fetch?: string; push?: string }> = {};
    for (const line of r.stdout.split('\n').filter(Boolean)) {
      const [name, url, type] = line.split(/\s+/);
      if (!remotes[name]) remotes[name] = {};
      if (type === '(fetch)') remotes[name].fetch = url;
      else if (type === '(push)') remotes[name].push = url;
    }
    return { remotes };
  },

  async remote_add(input) {
    if (!input.name || !input.url) throw new Error('Missing required fields: name, url');
    await runGit(['remote', 'add', input.name, input.url], input.cwd);
    return { added: input.name, url: input.url };
  },

  async remote_remove(input) {
    if (!input.name) throw new Error('Missing required field: name');
    await runGit(['remote', 'remove', input.name], input.cwd);
    return { removed: input.name };
  },

  async fetch(input) {
    const args = ['fetch'];
    if (input.remote) args.push(input.remote);
    if (input.prune) args.push('--prune');
    const r = await runGit(args, input.cwd);
    return { message: r.stderr || r.stdout || 'Fetch complete' };
  },

  async pull(input) {
    const args = ['pull'];
    if (input.rebase) args.push('--rebase');
    if (input.remote) args.push(input.remote);
    if (input.branch) args.push(input.branch);
    const r = await runGit(args, input.cwd);
    return { message: r.stdout || r.stderr };
  },

  async push(input) {
    const args = ['push'];
    if (input.force) args.push('--force-with-lease');
    if (input.set_upstream) args.push('-u');
    if (input.tags) args.push('--tags');
    if (input.remote) args.push(input.remote);
    if (input.branch) args.push(input.branch);
    const r = await runGit(args, input.cwd);
    return { message: r.stderr || r.stdout || 'Push complete' };
  },

  // ── Merge & Rebase ──
  async merge(input) {
    if (!input.branch) throw new Error('Missing required field: branch');
    const args = ['merge'];
    if (input.no_ff) args.push('--no-ff');
    if (input.message) args.push('-m', input.message);
    args.push(input.branch);
    const r = await runGit(args, input.cwd);
    return { message: r.stdout };
  },

  async rebase(input) {
    if (!input.branch) throw new Error('Missing required field: branch');
    const args = ['rebase'];
    if (input.onto) args.push('--onto', input.onto);
    args.push(input.branch);
    const r = await runGit(args, input.cwd);
    return { message: r.stdout || r.stderr };
  },

  // ── History ──
  async log(input) {
    const count = input.count || 10;
    const args = ['log', `-${count}`, '--format=%H\t%h\t%an\t%aI\t%s'];
    if (input.oneline) args.splice(2, 1, '--oneline');
    if (input.author) args.push(`--author=${input.author}`);
    if (input.since) args.push(`--since=${input.since}`);
    if (input.until) args.push(`--until=${input.until}`);
    if (input.ref) args.push(input.ref);
    if (input.path) args.push('--', input.path);
    const r = await runGit(args, input.cwd);
    if (input.oneline) return { log: r.stdout };
    const commits = r.stdout.split('\n').filter(Boolean).map(line => {
      const [hash, short_hash, author, date, ...messageParts] = line.split('\t');
      return { hash, short_hash, author, date, message: messageParts.join('\t') };
    });
    return { commits };
  },

  async diff(input) {
    const args = ['diff'];
    if (input.staged) args.push('--staged');
    if (input.stat) args.push('--stat');
    if (input.from_ref) {
      args.push(input.from_ref);
      if (input.to_ref) args.push(input.to_ref);
    }
    if (input.path) args.push('--', input.path);
    const r = await runGit(args, input.cwd);
    // Also get stat
    if (!input.stat) {
      try {
        const statArgs = [...args];
        const idx = statArgs.indexOf('diff');
        statArgs.splice(idx + 1, 0, '--stat');
        const s = await runGit(statArgs, input.cwd);
        const statLine = s.stdout.split('\n').pop() || '';
        const filesMatch = statLine.match(/(\d+) files? changed/);
        const insMatch = statLine.match(/(\d+) insertions?/);
        const delMatch = statLine.match(/(\d+) deletions?/);
        return {
          diff: r.stdout,
          files_changed: filesMatch ? parseInt(filesMatch[1]) : 0,
          insertions: insMatch ? parseInt(insMatch[1]) : 0,
          deletions: delMatch ? parseInt(delMatch[1]) : 0,
        };
      } catch {
        return { diff: r.stdout };
      }
    }
    return { diff: r.stdout };
  },

  async show(input) {
    const ref = input.ref || 'HEAD';
    const r = await runGit(['show', '--format=%H\t%an\t%aI\t%B', '--stat', ref], input.cwd);
    const lines = r.stdout.split('\n');
    const firstLine = lines[0] || '';
    const [hash, author, date, ...msgParts] = firstLine.split('\t');
    const restLines = lines.slice(1);
    // Find the stat section
    const emptyIdx = restLines.indexOf('');
    const message = msgParts.join('\t').trim();
    const stat = emptyIdx >= 0 ? restLines.slice(emptyIdx).join('\n').trim() : restLines.join('\n').trim();
    return { hash, author, date, message, stat };
  },

  async blame(input) {
    if (!input.path) throw new Error('Missing required field: path');
    const args = ['blame', '--porcelain'];
    if (input.lines) args.push(`-L${input.lines}`);
    args.push(input.path);
    const r = await runGit(args, input.cwd);
    // Parse porcelain blame output
    const lines: Array<{ hash: string; author: string; date: string; line_number: number; content: string }> = [];
    const blameLines = r.stdout.split('\n');
    let i = 0;
    while (i < blameLines.length) {
      const headerMatch = blameLines[i]?.match(/^([a-f0-9]{40}) \d+ (\d+)/);
      if (!headerMatch) { i++; continue; }
      const hash = headerMatch[1];
      const lineNum = parseInt(headerMatch[2]);
      let author = '', date = '', content = '';
      i++;
      while (i < blameLines.length && !blameLines[i]?.startsWith('\t')) {
        if (blameLines[i].startsWith('author ')) author = blameLines[i].slice(7);
        if (blameLines[i].startsWith('author-time ')) date = new Date(parseInt(blameLines[i].slice(12)) * 1000).toISOString();
        i++;
      }
      if (i < blameLines.length && blameLines[i]?.startsWith('\t')) {
        content = blameLines[i].slice(1);
        i++;
      }
      lines.push({ hash: hash.slice(0, 8), author, date, line_number: lineNum, content });
      if (lines.length >= 200) break;
    }
    return { lines };
  },

  // ── Tags ──
  async tag_list(input) {
    const r = await runGit(['tag', '-l', '--sort=-creatordate'], input.cwd);
    return { tags: r.stdout.split('\n').filter(Boolean) };
  },

  async tag_create(input) {
    if (!input.name) throw new Error('Missing required field: name');
    const args = ['tag'];
    if (input.message) args.push('-a', input.name, '-m', input.message);
    else args.push(input.name);
    if (input.ref) args.push(input.ref);
    await runGit(args, input.cwd);
    return { created: input.name };
  },

  async tag_delete(input) {
    if (!input.name) throw new Error('Missing required field: name');
    await runGit(['tag', '-d', input.name], input.cwd);
    return { deleted: input.name };
  },

  // ── Stash ──
  async stash_save(input) {
    const args = ['stash', 'push'];
    if (input.message) args.push('-m', input.message);
    const r = await runGit(args, input.cwd);
    return { message: r.stdout };
  },

  async stash_list(input) {
    const r = await runGit(['stash', 'list'], input.cwd);
    const stashes = r.stdout.split('\n').filter(Boolean).map(line => {
      const match = line.match(/^(stash@\{\d+\}): (.+)$/);
      return match ? { ref: match[1], description: match[2] } : { ref: line, description: line };
    });
    return { stashes };
  },

  async stash_apply(input) {
    const args = ['stash', 'apply'];
    if (input.index !== undefined) args.push(`stash@{${input.index}}`);
    const r = await runGit(args, input.cwd);
    return { message: r.stdout };
  },

  async stash_drop(input) {
    const args = ['stash', 'drop'];
    if (input.index !== undefined) args.push(`stash@{${input.index}}`);
    const r = await runGit(args, input.cwd);
    return { message: r.stdout };
  },

  // ── Advanced ──
  async clean(input) {
    const args = ['clean'];
    if (input.dry_run) args.push('-n');
    else if (input.force) args.push('-f');
    if (input.directories) args.push('-d');
    const r = await runGit(args, input.cwd);
    return { message: r.stdout || 'Nothing to clean' };
  },

  async reset(input) {
    const args = ['reset'];
    if (input.mode) args.push(`--${input.mode}`);
    if (input.ref) args.push(input.ref);
    const r = await runGit(args, input.cwd);
    return { message: r.stdout || r.stderr || 'Reset complete' };
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
