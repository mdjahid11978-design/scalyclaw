import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { getDb, getAllRecentMessages } from '../core/db.js';
import { getTopEntities } from '../memory/entities.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { ACTIVITY_KEY_PREFIX } from '../const/constants.js';
import { getProfile } from './tracker.js';
import type { Signal, SignalType, Trigger, TriggerType, TrackedTopic } from './types.js';
import type { ScalyClawConfig } from '../core/config.js';

// ─── Signal-to-Trigger Mapping ──────────────────────────────────────

const SIGNAL_TRIGGER_MAP: Record<SignalType, TriggerType> = {
  time_sensitive: 'urgent',
  pending_deliverable: 'deliverable',
  unfinished_topic: 'follow_up',
  entity_trigger: 'insight',
  idle: 'check_in',
  user_pattern: 'check_in',
  return_from_absence: 'check_in',
};

const TRIGGER_PRIORITY: Record<TriggerType, number> = {
  urgent: 1,
  deliverable: 2,
  follow_up: 3,
  insight: 4,
  check_in: 5,
};

// ─── Individual Signal Detectors ────────────────────────────────────

/** Signal 1: Idle detection — finds most recently active channel */
async function detectIdle(config: ScalyClawConfig['proactive']): Promise<Signal | null> {
  const redis = getRedis();
  const keys = await redis.keys(`${ACTIVITY_KEY_PREFIX}*`);
  if (keys.length === 0) return null;

  const now = Date.now();
  const thresholdMs = config.signals.idleThresholdMinutes * 60_000;
  const maxMs = config.signals.idleMaxDays * 24 * 60 * 60 * 1000;

  let bestChannel: string | null = null;
  let bestIdle = Infinity;

  for (const key of keys) {
    const tsStr = await redis.get(key);
    if (!tsStr) continue;
    const idleMs = now - Number(tsStr);
    if (idleMs >= thresholdMs && idleMs < maxMs && idleMs < bestIdle) {
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

/** Signal 2: Unfinished topics from proactive_topics table */
function detectUnfinishedTopics(config: ScalyClawConfig['proactive']): Signal | null {
  const d = getDb();
  const topics = d.prepare(
    `SELECT * FROM proactive_topics
     WHERE status = 'open'
       AND last_mentioned_at > datetime('now', ? || ' hours')
     ORDER BY last_mentioned_at ASC`
  ).all(`-${config.signals.topicExpiryHours}`) as Array<{
    id: string; topic: string; context: string | null; last_mentioned_at: string;
  }>;

  if (topics.length === 0) return null;

  // Strength increases with time since last mention
  const oldest = topics[0];
  const hoursSince = (Date.now() - new Date(oldest.last_mentioned_at).getTime()) / 3_600_000;
  const strength = Math.min(0.3 + (hoursSince / config.signals.topicExpiryHours) * 0.7, 1);

  return {
    type: 'unfinished_topic',
    strength,
    metadata: { topics: topics.map(t => t.topic), topicIds: topics.map(t => t.id) },
  };
}

/** Signal 3: Pending deliverables — assistant messages from scheduled sources after last user activity */
function detectPendingDeliverables(): Signal | null {
  const profile = getProfile();
  if (!profile.lastUserMsgAt) return null;

  const d = getDb();
  const deliverables = d.prepare(
    `SELECT content, metadata FROM messages
     WHERE role = 'assistant'
       AND metadata IS NOT NULL
       AND json_extract(metadata, '$.source') IN ('task', 'recurrent-task', 'reminder', 'recurrent-reminder')
       AND created_at > ?
     ORDER BY created_at DESC
     LIMIT 10`
  ).all(profile.lastUserMsgAt) as Array<{ content: string; metadata: string }>;

  if (deliverables.length === 0) return null;

  return {
    type: 'pending_deliverable',
    strength: 1.0,
    metadata: { count: deliverables.length, previews: deliverables.slice(0, 3).map(d => d.content.slice(0, 100)) },
  };
}

/** Signal 4: Time-sensitive memories (deadline proximity) */
function detectTimeSensitive(config: ScalyClawConfig['proactive']): Signal | null {
  const d = getDb();

  // FTS search for temporal keywords in memories
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
    // FTS not available or match failed
    return null;
  }

  if (rows.length === 0) return null;

  // Use importance as a proxy for urgency
  const maxImportance = Math.max(...rows.map(r => r.importance));
  const strength = Math.min(maxImportance / 10, 1);

  return {
    type: 'time_sensitive',
    strength,
    metadata: { memories: rows.map(r => ({ subject: r.subject, content: r.content.slice(0, 200) })) },
  };
}

/** Signal 5: Entity trigger — recently updated memories cross-referenced with top entities */
function detectEntityTrigger(): Signal | null {
  const d = getDb();

  // Get memories updated in last 24h
  const recentMemories = d.prepare(
    `SELECT id FROM memories WHERE updated_at > datetime('now', '-1 day')`
  ).all() as Array<{ id: string }>;

  if (recentMemories.length === 0) return null;

  // Check if any top entities are mentioned in these recent memories
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

/** Signal 6: User pattern — current hour matches typically active window */
function detectUserPattern(): Signal | null {
  const profile = getProfile();
  const pattern = profile.activityPattern;
  const totalActivity = pattern.reduce((s, v) => s + v, 0);
  if (totalActivity < 10) return null; // Not enough data

  const now = new Date();
  const hour = now.getUTCHours(); // Will be adjusted by timezone in timing.ts
  const hourActivity = pattern[hour] ?? 0;
  const avgActivity = totalActivity / 24;

  // Current hour has above-average activity but user hasn't engaged
  if (hourActivity <= avgActivity) return null;
  if (profile.lastUserMsgAt) {
    const sinceLastMsg = Date.now() - new Date(profile.lastUserMsgAt).getTime();
    if (sinceLastMsg < 30 * 60_000) return null; // Active within 30 min
  }

  return {
    type: 'user_pattern',
    strength: 0.3,
    metadata: { hour, hourActivity, avgActivity: Math.round(avgActivity) },
  };
}

/** Signal 7: Return from absence — user came back after long absence */
async function detectReturnFromAbsence(config: ScalyClawConfig['proactive']): Promise<Signal | null> {
  const profile = getProfile();
  if (!profile.lastUserMsgAt) return null;

  const absenceMs = Date.now() - new Date(profile.lastUserMsgAt).getTime();
  const thresholdMs = config.signals.returnFromAbsenceHours * 3_600_000;

  // Check if user has been active very recently (within 5 min) AND was absent before
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
  // User returned = active within 5 min, but last tracked profile activity was > threshold
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

  try {
    const results = await Promise.allSettled([
      detectIdle(config),
      Promise.resolve(detectUnfinishedTopics(config)),
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
  } catch (err) {
    log('error', 'Signal detection failed', { error: String(err) });
  }

  return signals;
}

// ─── Aggregate Signals into Trigger ─────────────────────────────────

export function aggregateSignals(
  signals: Signal[],
  weights: ScalyClawConfig['proactive']['triggerWeights'],
): Trigger | null {
  if (signals.length === 0) return null;

  // Find highest-priority trigger type
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

  // Compute weighted aggregate strength
  let totalStrength = 0;
  for (const signal of signals) {
    const triggerType = SIGNAL_TRIGGER_MAP[signal.type];
    const weight = weights[triggerType] ?? 0.5;
    totalStrength += signal.strength * weight;
  }

  // Normalize to 0-1 range (divide by max possible weight sum)
  const maxPossible = signals.length * Math.max(...Object.values(weights));
  const aggregateStrength = maxPossible > 0 ? Math.min(totalStrength / maxPossible, 1) : 0;

  return {
    type: bestType,
    signals,
    aggregateStrength,
  };
}

// ─── Find Best Channel for Delivery ─────────────────────────────────

export async function findBestChannel(): Promise<string | null> {
  const redis = getRedis();
  const keys = await redis.keys(`${ACTIVITY_KEY_PREFIX}*`);
  if (keys.length === 0) return null;

  let bestChannel: string | null = null;
  let bestTs = 0;

  for (const key of keys) {
    const tsStr = await redis.get(key);
    if (tsStr) {
      const ts = Number(tsStr);
      if (ts > bestTs) {
        bestTs = ts;
        bestChannel = key.slice(ACTIVITY_KEY_PREFIX.length);
      }
    }
  }

  return bestChannel;
}

// ─── Open Topics ────────────────────────────────────────────────────

export function getOpenTopics(): TrackedTopic[] {
  const d = getDb();
  return d.prepare(
    `SELECT * FROM proactive_topics WHERE status = 'open' ORDER BY last_mentioned_at DESC`
  ).all() as TrackedTopic[];
}

export function expireOldTopics(expiryHours: number): number {
  const d = getDb();
  d.prepare(
    `UPDATE proactive_topics
     SET status = 'expired'
     WHERE status = 'open'
       AND last_mentioned_at < datetime('now', ? || ' hours')`
  ).run(`-${expiryHours}`);
  const row = d.prepare('SELECT changes() as c').get() as { c: number };
  return row.c;
}
