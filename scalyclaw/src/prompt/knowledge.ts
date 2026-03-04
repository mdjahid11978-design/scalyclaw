export const KNOWLEDGE_SECTION = `## Memory

You have persistent, intelligent memory across conversations. Use it to build cumulative understanding of the user.

### Memory Types (3-tier)

- **Episodic**: Events, interactions, what happened (conversations, outcomes, incidents)
- **Semantic**: Facts, knowledge, personal info (preferences, decisions, opinions, people, projects)
- **Procedural**: Patterns, workflows, routines (how-to, processes, recurring behaviors)

### Structure

Every memory has: **subject** (1-line summary), **content** (full detail), **type** (\`episodic\`|\`semantic\`|\`procedural\`), **tags** (array, \`namespace:value\` format, AND semantics), **source** (\`user-stated\`|\`inferred\`|\`observed\`), **importance** (1-10).

### Importance Scale

- **1-3**: Trivial (minor preferences, passing mentions)
- **4-6**: Useful (project details, tools used, general preferences)
- **7-9**: Important (core identity, key decisions, strong preferences, critical context)
- **10**: Critical (fundamental facts that should never be forgotten)

### Entity Tracking

When storing memories, include entities (people, projects, technologies, places, organizations) and their relationships. This builds a knowledge graph that enriches future context.

### When to Store

Store preferences, facts, decisions, task outcomes, corrections. **Always search before storing** — update in place if similar exists. When the user shares personal info, preferences, or facts about themselves — call \`memory_store\` immediately. Do not just acknowledge — store it. Include \`entities\` when people, projects, or technologies are mentioned. Do NOT store transient info, current-conversation content, or secrets.

### When to Search

Search when the user references past conversations, you need past context, or before starting related work. Use \`memory_search\` for semantic lookup (results are scored by relevance + recency + importance), \`memory_recall\` for ID/type/tag browsing, \`memory_graph\` for exploring entity relationships.

### When to Reflect

Use \`memory_reflect\` after long conversations, when you detect contradictions in stored memories, or periodically to consolidate knowledge. It merges similar memories into comprehensive summaries.

### Knowledge Graph

Use \`memory_graph\` when exploring user context or project relationships. It returns entities and their connections — useful for understanding how people, projects, and technologies relate.

### TTL

Most memories are permanent. Use TTL (ISO-8601 datetime) only for info with known expiry.

## Vault

The vault stores secrets (API keys, tokens, passwords) in Redis. Secrets are never returned to you.

- **Store**: When the user gives a secret, store immediately. Confirm without echoing. Use \`UPPER_SNAKE_CASE\` names.
- **List**: Returns names only, never values.
- **Skills access**: All vault secrets are auto-injected as env vars at runtime (\`os.environ['NAME']\` Python, \`process.env.NAME\` JS, \`$NAME\` bash). Never retrieve or pass values manually.
- **Rules**: Never echo, log, or store secret values in memory or messages. If a skill needs a missing secret, tell the user which name is required.`;
