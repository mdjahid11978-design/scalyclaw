import { getDb } from '../core/db.js';
import { getConfigRef } from '../core/config.js';
import { log } from '@scalyclaw/shared/core/logger.js';

export interface ScoringWeights {
  semantic: number;
  recency: number;
  importance: number;
}

export interface ScoringConfig {
  weights: ScoringWeights;
  decayRate: number;
}

/**
 * Compute composite score combining embedding similarity, recency, and importance.
 *
 * final = w_semantic * embeddingScore + w_recency * recencyWeight + w_importance * importanceWeight
 */
export function computeCompositeScore(
  embeddingScore: number,
  updatedAt: string,
  importance: number,
  config?: ScoringConfig,
): number {
  const cfg = config ?? getDefaultScoringConfig();
  const { weights, decayRate } = cfg;

  const recencyWeight = computeRecencyWeight(updatedAt, decayRate);
  const importanceWeight = Math.min(Math.max(importance, 1), 10) / 10;

  return (
    weights.semantic * embeddingScore +
    weights.recency * recencyWeight +
    weights.importance * importanceWeight
  );
}

/**
 * Exponential decay based on days since update.
 * recency_weight = exp(-λ * days_since_update)
 */
export function computeRecencyWeight(updatedAt: string, decayRate = 0.05): number {
  const now = Date.now();
  const updated = new Date(updatedAt + (updatedAt.includes('Z') || updatedAt.includes('+') ? '' : 'Z')).getTime();
  const daysSinceUpdate = Math.max(0, (now - updated) / (1000 * 60 * 60 * 24));
  return Math.exp(-decayRate * daysSinceUpdate);
}

/**
 * Compute a decayed importance that considers access frequency.
 * Frequently accessed memories resist decay.
 */
export function computeDecayedImportance(
  importance: number,
  lastAccessedAt: string | null,
  accessCount: number,
): number {
  if (!lastAccessedAt) return importance;
  const daysSinceAccess = Math.max(
    0,
    (Date.now() - new Date(lastAccessedAt + (lastAccessedAt.includes('Z') || lastAccessedAt.includes('+') ? '' : 'Z')).getTime()) / (1000 * 60 * 60 * 24),
  );
  // Access count provides a boost that resists decay
  const accessBoost = Math.min(accessCount * 0.1, 2);
  const decayedImportance = importance * Math.exp(-0.01 * daysSinceAccess) + accessBoost;
  return Math.min(10, Math.max(1, Math.round(decayedImportance)));
}

/**
 * Track access: increment access_count and refresh last_accessed_at.
 */
export function trackAccess(memoryId: string): void {
  try {
    const db = getDb();
    db.prepare(
      "UPDATE memories SET access_count = access_count + 1, last_accessed_at = datetime('now') WHERE id = ?",
    ).run(memoryId);
  } catch (err) {
    log('warn', 'Failed to track memory access', { memoryId, error: String(err) });
  }
}

/**
 * Batch track access for multiple memory IDs.
 */
export function trackAccessBatch(memoryIds: string[]): void {
  if (memoryIds.length === 0) return;
  try {
    const db = getDb();
    const stmt = db.prepare(
      "UPDATE memories SET access_count = access_count + 1, last_accessed_at = datetime('now') WHERE id = ?",
    );
    const batchUpdate = db.transaction(() => {
      for (const id of memoryIds) {
        stmt.run(id);
      }
    });
    batchUpdate();
  } catch (err) {
    log('warn', 'Failed to batch track memory access', { count: memoryIds.length, error: String(err) });
  }
}

function getDefaultScoringConfig(): ScoringConfig {
  const config = getConfigRef();
  const mem = config.memory as Record<string, unknown>;
  const weights = (mem.weights as ScoringWeights | undefined) ?? { semantic: 0.6, recency: 0.2, importance: 0.2 };
  const decayRate = (mem.decayRate as number | undefined) ?? 0.05;
  return { weights, decayRate };
}
