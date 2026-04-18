import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllRecentMessages, getDb } from '../core/db.js';
import { searchMemory } from '../memory/memory.js';
import { getEntityGraph } from '../memory/entities.js';
import { PATHS } from '../core/paths.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { getProfile } from './tracker.js';
import type { ProactiveContext, Trigger, Signal } from './types.js';

// ─── Build Search Query from Signals ────────────────────────────────

function buildSearchQuery(signals: Signal[]): string {
  const terms: string[] = [];

  for (const signal of signals) {
    const meta = signal.metadata;
    if (signal.type === 'entity_trigger' && Array.isArray(meta.entities)) {
      terms.push(...(meta.entities as Array<{ name: string }>).map(e => e.name));
    }
    if (signal.type === 'time_sensitive' && Array.isArray(meta.memories)) {
      terms.push(...(meta.memories as Array<{ subject: string }>).map(m => m.subject));
    }
    if (signal.type === 'pending_deliverable' && Array.isArray(meta.previews)) {
      terms.push(...(meta.previews as string[]).slice(0, 2));
    }
  }

  if (terms.length === 0) return 'recent important context';
  return terms.slice(0, 5).join(' ');
}

/** Matches the cursor logic in detectPendingDeliverables: use lastProactiveAt,
 *  fall back to "anything in the last 24h" on cold start. */
function getPendingDeliverables(lastProactiveAt: string | null): Array<{ content: string; source: string }> {
  const cursor = lastProactiveAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const d = getDb();
  const rows = d.prepare(
    `SELECT content, metadata FROM messages
     WHERE role = 'assistant'
       AND metadata IS NOT NULL
       AND json_extract(metadata, '$.source') IN ('task', 'recurrent-task', 'reminder', 'recurrent-reminder')
       AND created_at > ?
     ORDER BY created_at DESC
     LIMIT 10`
  ).all(cursor) as Array<{ content: string; metadata: string }>;

  return rows.map(r => {
    let source = 'result';
    try { source = JSON.parse(r.metadata).source ?? 'result'; } catch {}
    return { content: r.content, source };
  });
}

// ─── Temporal Memories ──────────────────────────────────────────────

function getTemporalMemories(): Array<{ subject: string; content: string }> {
  const d = getDb();
  try {
    return d.prepare(
      `SELECT m.subject, m.content
       FROM memory_fts f
       JOIN memories m ON m.id = f.id
       WHERE memory_fts MATCH 'deadline OR due OR meeting OR appointment OR tomorrow OR today OR schedule'
         AND m.importance >= 5
         AND (m.ttl IS NULL OR m.ttl > datetime('now'))
       ORDER BY m.importance DESC
       LIMIT 5`
    ).all() as Array<{ subject: string; content: string }>;
  } catch {
    return [];
  }
}

// ─── Assemble Full Context ──────────────────────────────────────────

export async function assembleContext(trigger: Trigger): Promise<ProactiveContext> {
  const profile = getProfile();

  let identity = '';
  try {
    identity = await readFile(join(PATHS.mind, 'IDENTITY.md'), 'utf-8');
  } catch {
    log('debug', 'Proactive context: IDENTITY.md not found');
  }

  // Recent messages across all channels
  const rawMessages = getAllRecentMessages(20);
  const recentMessages = rawMessages.map(m => ({
    role: m.role,
    content: m.content,
    channel: m.channel,
    createdAt: m.created_at,
  }));

  // Semantic memory search seeded from signals
  const query = buildSearchQuery(trigger.signals);
  let memories: ProactiveContext['memories'] = [];
  try {
    const results = await searchMemory(query, { topK: 5 });
    memories = results.map(r => ({
      subject: r.subject,
      content: r.content,
      type: r.type,
      importance: r.importance,
    }));
  } catch (err) {
    log('warn', 'Proactive context: memory search failed', { error: String(err) });
  }

  // Entity graph for referenced entities
  const entityGraph: ProactiveContext['entityGraph'] = [];
  for (const signal of trigger.signals) {
    if (signal.type === 'entity_trigger' && Array.isArray(signal.metadata.entities)) {
      for (const ent of (signal.metadata.entities as Array<{ name: string }>).slice(0, 3)) {
        try {
          const nodes = getEntityGraph(ent.name, 1);
          for (const node of nodes) {
            if (!entityGraph.some(e => e.name === node.name)) {
              entityGraph.push({
                name: node.name,
                type: node.type,
                relations: node.relations.map(r => ({ relation: r.relation, target: r.target })),
              });
            }
          }
        } catch { /* entity graph best-effort */ }
      }
    }
  }

  const temporalMemories = getTemporalMemories();
  const pendingDeliverables = getPendingDeliverables(profile.lastProactiveAt);

  return {
    recentMessages,
    memories,
    entityGraph,
    temporalMemories,
    pendingDeliverables,
    profile,
    identity,
    currentTime: new Date().toISOString(),
    trigger,
  };
}
