import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { getDb } from '../core/db.js';
import { getTopEntities } from '../memory/entities.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { ACTIVITY_KEY_PREFIX } from '../const/constants.js';
import { getProfile } from './tracker.js';
import type { Signal, SignalType, Trigger, TriggerType } from './types.js';
import type { ScalyClawConfig } from '../core/config.js';

// ─── Signal-to-Trigger Mapping ──────────────────────────────────────

const SIGNAL_TRIGGER_MAP: Record<SignalType, TriggerType> = {
  time_sensitive: 'urgent',
  pending_deliverable: 'deliverable',
  entity_trigger: 'insight',
  idle: 'check_in',
  user_pattern: 'check_in',
  return_from_absence: 'check_in',
};

const TRIGGER_PRIORITY: Record<TriggerType, number> = {
  urgent: 1,
  deliverable: 2,
  insight: 3,
  check_in: 4,
};

// ─── Individual Signal Detectors ────────────────────────────────────

/** Signal: Idle detection — any channel idle past the threshold. */
async function detectIdle(config: ScalyClawConfig['proactive']): Promise<Signal | null> {
  const redis = getRedis();
  const keys = await redis.keys(`${ACTIVITY_KEY_PREFIX}*`);
  if (keys.length === 0) return null;

  const now = Date.now();
  const thresholdMs = config.signals.idleThresholdMinutes * 60_000;
  const maxMs = config.signals.idleMaxDays * 24 * 60 * 60 * 1000;

  let bestIdle = 0;
  let bestChannel: string | null = null;

  for (const key of keys) {
    const tsStr = await redis.get(key);
    if (!tsStr) continue;
    const idleMs = now - Number(tsStr);
    if (idleMs >= thresholdMs && idleMs < maxMs && idleMs > bestIdle) {
      bestIdle = idleMs;
      bestChannel = key.slice(ACTIVITY_KEY_PREFIX.length);
    }
  }

  if (!bestChannel) return null;

  // Strength scales from 0.3 (just past threshold) to 1.0 (approaching max)
  const fraction = (bestIdle - thresholdMs) / (maxMs - thresholdMs);
  const strength = 0.3 + 0.7 * Math.min(fraction, 1);

  return {
    type: 'idle',
    strength,
    metadata: { channel: bestChannel, idleMinutes: Math.round(bestIdle / 60_000) },
  };
}

/**
 * Signal: pending deliverables — scheduled-task / reminder results stored in the
 * messages table that haven't yet been surfaced proactively. The cursor is
 * `lastProactiveAt` (not `lastUserMsgAt`) so deliverables produced while the user
 * was idle still qualify. On cold start (`lastProactiveAt == null`) we look back
 * 24h so the system can fire on a newly-installed instance.
 */
function detectPendingDeliverables(): Signal | null {
  const profile = getProfile();
  const cursor = profile.lastProactiveAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const d = getDb();
  const deliverables = d.prepare(
    `SELECT content, metadata FROM messages
     WHERE role = 'assistant'
       AND metadata IS NOT NULL
       AND json_extract(metadata, '$.source') IN ('task', 'recurrent-task', 'reminder', 'recurrent-reminder')
       AND created_at > ?
     ORDER BY created_at DESC
     LIMIT 10`
  ).all(cursor) as Array<{ content: string; metadata: string }>;

  if (deliverables.length === 0) return null;

  return {
    type: 'pending_deliverable',
    strength: 1.0,
    metadata: { count: deliverables.length, previews: deliverables.slice(0, 3).map(d => d.content.slice(0, 100)) },
  };
}

/** Signal: Time-sensitive memories (deadline proximity). */
function detectTimeSensitive(_config: ScalyClawConfig['proactive']): Signal | null {
  const d = getDb();

  let rows: Array<{ subject: string; content: string; importance: number }>;
  try {
    rows = d.prepare(
      `SELECT m.subject, m.content, m.importance
       FROM memory_fts f
       JOIN memories m ON m.id = f.id
       WHERE memory_fts MATCH 'deadline OR due OR meeting OR appointment OR expires OR expiring OR "due date" OR schedule'
         AND m.importance >= 5
         AND (m.ttl IS NULL OR m.ttl > datetime('now'))
       ORDER BY m.importance DESC
       LIMIT 5`
    ).all() as Array<{ subject: string; content: string; importance: number }>;
  } catch {
    return null;
  }

  if (rows.length === 0) return null;

  const maxImportance = Math.max(...rows.map(r => r.importance));
  const strength = Math.min(maxImportance / 10, 1);

  return {
    type: 'time_sensitive',
    strength,
    metadata: { memories: rows.map(r => ({ subject: r.subject, content: r.content.slice(0, 200) })) },
  };
}

/** Signal: Entity trigger — recently updated memories cross-referenced with top entities. */
function detectEntityTrigger(): Signal | null {
  const d = getDb();

  const recentMemories = d.prepare(
    `SELECT id FROM memories WHERE updated_at > datetime('now', '-1 day')`
  ).all() as Array<{ id: string }>;

  if (recentMemories.length === 0) return null;

  const topEntities = getTopEntities(5);
  if (topEntities.length === 0) return null;

  const recentIds = new Set(recentMemories.map(m => m.id));
  const matchedEntities: Array<{ name: string; type: string; mentionCount: number }> = [];

  for (const entity of topEntities) {
    const mentions = d.prepare(
      `SELECT memory_id FROM memory_entity_mentions WHERE entity_id = (
         SELECT id FROM memory_entities WHERE name = ? LIMIT 1
       )`
    ).all(entity.name) as Array<{ memory_id: string }>;

    if (mentions.some(m => recentIds.has(m.memory_id))) {
      matchedEntities.push(entity);
    }
  }

  if (matchedEntities.length === 0) return null;

  const maxMentions = Math.max(...matchedEntities.map(e => e.mentionCount));
  const strength = Math.min(0.3 + (maxMentions / 20) * 0.7, 1);

  return {
    type: 'entity_trigger',
    strength,
    metadata: { entities: matchedEntities.map(e => ({ name: e.name, type: e.type })) },
  };
}

/** Signal: User pattern — current hour matches typically active window. */
function detectUserPattern(): Signal | null {
  const profile = getProfile();
  const pattern = profile.activityPattern;
  const totalActivity = pattern.reduce((s, v) => s + v, 0);
  if (totalActivity < 10) return null; // not enough history

  const now = new Date();
  const hour = now.getUTCHours();
  const hourActivity = pattern[hour] ?? 0;
  const avgActivity = totalActivity / 24;

  if (hourActivity <= avgActivity) return null;
  if (profile.lastUserMsgAt) {
    const sinceLastMsg = Date.now() - new Date(profile.lastUserMsgAt).getTime();
    if (sinceLastMsg < 30 * 60_000) return null; // user active within 30 min
  }

  return {
    type: 'user_pattern',
    strength: 0.3,
    metadata: { hour, hourActivity, avgActivity: Math.round(avgActivity) },
  };
}

/** Signal: Return from absence — user came back after long absence. */
async function detectReturnFromAbsence(config: ScalyClawConfig['proactive']): Promise<Signal | null> {
  const profile = getProfile();
  if (!profile.lastUserMsgAt) return null;

  const absenceMs = Date.now() - new Date(profile.lastUserMsgAt).getTime();
  const thresholdMs = config.signals.returnFromAbsenceHours * 3_600_000;

  const redis = getRedis();
  const keys = await redis.keys(`${ACTIVITY_KEY_PREFIX}*`);
  let mostRecentActivity = 0;

  for (const key of keys) {
    const tsStr = await redis.get(key);
    if (tsStr) {
      mostRecentActivity = Math.max(mostRecentActivity, Number(tsStr));
    }
  }

  if (mostRecentActivity === 0) return null;

  const sinceLastActivity = Date.now() - mostRecentActivity;
  // User returned = active within 5 min, but profile activity was > threshold ago
  if (sinceLastActivity > 5 * 60_000) return null;
  if (absenceMs < thresholdMs) return null;

  return {
    type: 'return_from_absence',
    strength: 0.8,
    metadata: { absenceHours: Math.round(absenceMs / 3_600_000) },
  };
}

// ─── Detect All Signals ─────────────────────────────────────────────

export async function detectAllSignals(config: ScalyClawConfig['proactive']): Promise<Signal[]> {
  const signals: Signal[] = [];

  const results = await Promise.allSettled([
    detectIdle(config),
    Promise.resolve(detectPendingDeliverables()),
    Promise.resolve(detectTimeSensitive(config)),
    Promise.resolve(detectEntityTrigger()),
    Promise.resolve(detectUserPattern()),
    detectReturnFromAbsence(config),
  ]);

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      signals.push(result.value);
    } else if (result.status === 'rejected') {
      log('warn', 'Signal detector failed', { error: String(result.reason) });
    }
  }

  return signals;
}

// ─── Aggregate Signals into Trigger ─────────────────────────────────

export function aggregateSignals(
  signals: Signal[],
  weights: ScalyClawConfig['proactive']['triggerWeights'],
): Trigger | null {
  if (signals.length === 0) return null;

  let bestType: TriggerType = 'check_in';
  let bestPriority = Infinity;

  for (const signal of signals) {
    const triggerType = SIGNAL_TRIGGER_MAP[signal.type];
    const priority = TRIGGER_PRIORITY[triggerType];
    if (priority < bestPriority) {
      bestPriority = priority;
      bestType = triggerType;
    }
  }

  let totalStrength = 0;
  for (const signal of signals) {
    const triggerType = SIGNAL_TRIGGER_MAP[signal.type];
    const weight = weights[triggerType] ?? 0.5;
    totalStrength += signal.strength * weight;
  }

  const maxPossible = signals.length * Math.max(...Object.values(weights));
  const aggregateStrength = maxPossible > 0 ? Math.min(totalStrength / maxPossible, 1) : 0;

  return {
    type: bestType,
    signals,
    aggregateStrength,
  };
}
