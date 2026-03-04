import { randomUUID } from 'node:crypto';
import { getDb, isVecAvailable, recordUsage } from '../core/db.js';
import { getConfigRef } from '../core/config.js';
import { selectModel, parseModelId } from '../models/provider.js';
import { getProvider } from '../models/registry.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { withRetry } from '@scalyclaw/shared/core/retry.js';
import { generateEmbedding, vectorToBlob, isEmbeddingsAvailable } from './embeddings.js';
import { relinkEntitiesToConsolidated } from './entities.js';
import { CONSOLIDATION_PROMPT } from '../prompt/consolidation.js';
import { EMBEDDING_RETRY_ATTEMPTS } from '../const/constants.js';
import { serializeTags } from './memory.js';

interface MemoryRow {
  id: string;
  type: string;
  subject: string;
  content: string;
  tags: string | null;
  importance: number;
  embedding: Buffer | null;
  updated_at: string;
}

interface ConsolidationResult {
  consolidated: number;
  clusters: number;
  newMemoryIds: string[];
}

/**
 * Run memory consolidation: find similar clusters, merge via LLM, mark originals.
 */
export async function runConsolidation(): Promise<ConsolidationResult> {
  const config = getConfigRef();
  const memConfig = config.memory as Record<string, unknown>;
  const consolConfig = (memConfig.consolidation as Record<string, unknown> | undefined) ?? {};

  const similarityThreshold = (consolConfig.similarityThreshold as number | undefined) ?? 0.85;
  const maxClusterSize = (consolConfig.maxClusterSize as number | undefined) ?? 5;

  log('info', 'Starting memory consolidation');

  const db = getDb();

  // Get all non-consolidated memories with embeddings
  const memories = db.prepare(`
    SELECT id, type, subject, content, tags, importance, embedding, updated_at
    FROM memories
    WHERE consolidated_into IS NULL
      AND embedding IS NOT NULL
      AND (ttl IS NULL OR ttl > datetime('now'))
    ORDER BY type, updated_at DESC
  `).all() as MemoryRow[];

  if (memories.length < 2) {
    log('info', 'Consolidation skipped — not enough memories', { count: memories.length });
    return { consolidated: 0, clusters: 0, newMemoryIds: [] };
  }

  // Find clusters of similar memories within same type
  const clusters = findClusters(memories, similarityThreshold, maxClusterSize);

  if (clusters.length === 0) {
    log('info', 'Consolidation complete — no clusters found');
    return { consolidated: 0, clusters: 0, newMemoryIds: [] };
  }

  log('info', 'Found clusters for consolidation', { clusterCount: clusters.length, totalMemories: clusters.reduce((s, c) => s + c.length, 0) });

  const newMemoryIds: string[] = [];
  let consolidated = 0;

  for (const cluster of clusters) {
    try {
      const newId = await mergeCluster(cluster);
      if (newId) {
        newMemoryIds.push(newId);
        consolidated += cluster.length;
      }
    } catch (err) {
      log('warn', 'Failed to merge cluster', { clusterSize: cluster.length, error: String(err) });
    }
  }

  log('info', 'Consolidation complete', { consolidated, clusters: clusters.length, newMemoryIds: newMemoryIds.length });
  return { consolidated, clusters: clusters.length, newMemoryIds };
}

/**
 * Find clusters of similar memories using pairwise vector comparison.
 */
function findClusters(memories: MemoryRow[], threshold: number, maxSize: number): MemoryRow[][] {
  if (!isVecAvailable()) return [];

  const db = getDb();
  const clustered = new Set<string>();
  const clusters: MemoryRow[][] = [];

  // Group by type first
  const byType = new Map<string, MemoryRow[]>();
  for (const mem of memories) {
    const group = byType.get(mem.type) ?? [];
    group.push(mem);
    byType.set(mem.type, group);
  }

  for (const [, typeMemories] of byType) {
    if (typeMemories.length < 2) continue;

    for (let i = 0; i < typeMemories.length; i++) {
      const mem = typeMemories[i];
      if (clustered.has(mem.id)) continue;

      // Find similar memories using vector search
      const similar = db.prepare(
        'SELECT id, distance FROM memory_vec WHERE embedding MATCH ? AND id != ? ORDER BY distance LIMIT ?',
      ).all(mem.embedding, mem.id, maxSize * 2) as Array<{ id: string; distance: number }>;

      const clusterMembers: MemoryRow[] = [mem];
      clustered.add(mem.id);

      for (const s of similar) {
        if (clusterMembers.length >= maxSize) break;
        if (clustered.has(s.id)) continue;

        const score = 1 - s.distance;
        if (score < threshold) continue;

        // Ensure same type
        const candidate = typeMemories.find(m => m.id === s.id);
        if (!candidate) continue;

        clusterMembers.push(candidate);
        clustered.add(s.id);
      }

      if (clusterMembers.length >= 2) {
        clusters.push(clusterMembers);
      } else {
        // Unmark single-member "cluster"
        clustered.delete(mem.id);
      }
    }
  }

  return clusters;
}

/**
 * Merge a cluster of memories into a single consolidated memory via LLM.
 */
async function mergeCluster(cluster: MemoryRow[]): Promise<string | null> {
  const config = getConfigRef();

  const modelId = selectModel(
    config.models.models.filter(m => m.enabled).map(m => ({ model: m.id, weight: m.weight, priority: m.priority })),
  );
  if (!modelId) {
    log('warn', 'Consolidation merge skipped — no model available');
    return null;
  }

  const { provider: providerId, model } = parseModelId(modelId);
  const provider = getProvider(providerId);

  const clusterData = cluster.map(m => ({
    subject: m.subject,
    content: m.content,
    type: m.type,
    importance: m.importance,
  }));

  const response = await provider.chat({
    model,
    systemPrompt: CONSOLIDATION_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(clusterData) }],
    temperature: 0,
    maxTokens: 2048,
  });

  recordUsage({
    model: modelId,
    provider: providerId,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    type: 'memory',
  });

  // Parse response
  let content = response.content;
  content = content.replace(/<think>[\s\S]*?<\/think>/g, '');
  content = content.replace(/<\|[^|]*\|>/g, '');

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log('warn', 'Consolidation LLM returned no JSON');
    return null;
  }

  const merged = JSON.parse(jsonMatch[0]) as {
    subject: string;
    content: string;
    type: string;
    importance: number;
    tags?: string[];
  };

  if (!merged.subject || !merged.content) {
    log('warn', 'Consolidation LLM returned invalid merged memory');
    return null;
  }

  // Use max importance from cluster
  const maxImportance = Math.max(...cluster.map(m => m.importance), merged.importance ?? 5);

  // Generate embedding for merged memory
  const embeddingText = merged.subject + '\n' + merged.content;
  let embeddingBlob: Buffer | null = null;
  if (isEmbeddingsAvailable()) {
    try {
      const embedding = await withRetry(() => generateEmbedding(embeddingText), {
        attempts: EMBEDDING_RETRY_ATTEMPTS,
        baseDelay: 500,
        label: 'Embedding (consolidation)',
      });
      embeddingBlob = vectorToBlob(embedding);
    } catch (err) {
      log('warn', 'Embedding generation failed during consolidation', { error: String(err) });
    }
  }

  const db = getDb();
  const newId = randomUUID();
  const tags = merged.tags ?? [];
  const tagsStr = serializeTags(tags);
  const oldIds = cluster.map(m => m.id);

  const consolidate = db.transaction(() => {
    // Store merged memory
    db.prepare(
      'INSERT INTO memories (id, type, subject, content, tags, source, importance, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(newId, merged.type || 'semantic', merged.subject, merged.content, tagsStr, 'consolidation', maxImportance, embeddingBlob);

    // Tags
    for (const tag of tags) {
      db.prepare('INSERT INTO memory_tags (memory_id, tag) VALUES (?, ?)').run(newId, tag);
    }

    // Vec
    if (embeddingBlob && isVecAvailable()) {
      db.prepare('INSERT INTO memory_vec (id, embedding) VALUES (?, ?)').run(newId, embeddingBlob);
    }

    // FTS
    db.prepare('INSERT INTO memory_fts (id, subject, content, tags, type) VALUES (?, ?, ?, ?, ?)').run(
      newId, merged.subject, merged.content, tagsStr ?? '', merged.type || 'semantic',
    );

    // Mark originals as consolidated
    const placeholders = oldIds.map(() => '?').join(',');
    db.prepare(
      `UPDATE memories SET consolidated_into = ? WHERE id IN (${placeholders})`,
    ).run(newId, ...oldIds);
  });
  consolidate();

  // Re-link entities (outside transaction since it's non-critical)
  relinkEntitiesToConsolidated(oldIds, newId);

  log('info', 'Cluster merged', { newId, mergedCount: cluster.length, subject: merged.subject });
  return newId;
}
