import { randomUUID } from 'node:crypto';
import { getDb } from '../core/db.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import type {
  EngagementEvent, EngagementProfile, EngagementOutcome,
  Sentiment, TriggerType, SignalType, StylePreference,
} from './types.js';

// ─── Profile ────────────────────────────────────────────────────────

interface ProfileRow {
  engagement_score: number;
  activity_pattern: string | null;
  avg_response_time_s: number | null;
  total_sent: number;
  total_engaged: number;
  total_dismissed: number;
  last_proactive_at: string | null;
  last_user_msg_at: string | null;
  muted_until: string | null;
  style_preference: string;
  updated_at: string;
}

export function getProfile(): EngagementProfile {
  const d = getDb();
  const row = d.prepare('SELECT * FROM proactive_profile WHERE id = 1').get() as ProfileRow;
  return {
    engagementScore: row.engagement_score,
    activityPattern: row.activity_pattern ? JSON.parse(row.activity_pattern) : new Array(24).fill(0),
    avgResponseTimeS: row.avg_response_time_s,
    totalSent: row.total_sent,
    totalEngaged: row.total_engaged,
    totalDismissed: row.total_dismissed,
    lastProactiveAt: row.last_proactive_at,
    lastUserMsgAt: row.last_user_msg_at,
    mutedUntil: row.muted_until,
    stylePreference: (row.style_preference ?? 'balanced') as StylePreference,
    updatedAt: row.updated_at,
  };
}

export function updateProfile(updates: Partial<Pick<EngagementProfile,
  'engagementScore' | 'activityPattern' | 'avgResponseTimeS' |
  'totalSent' | 'totalEngaged' | 'totalDismissed' |
  'lastProactiveAt' | 'lastUserMsgAt' | 'mutedUntil' | 'stylePreference'
>>): void {
  const d = getDb();
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.engagementScore !== undefined) { sets.push('engagement_score = ?'); params.push(updates.engagementScore); }
  if (updates.activityPattern !== undefined) { sets.push('activity_pattern = ?'); params.push(JSON.stringify(updates.activityPattern)); }
  if (updates.avgResponseTimeS !== undefined) { sets.push('avg_response_time_s = ?'); params.push(updates.avgResponseTimeS); }
  if (updates.totalSent !== undefined) { sets.push('total_sent = ?'); params.push(updates.totalSent); }
  if (updates.totalEngaged !== undefined) { sets.push('total_engaged = ?'); params.push(updates.totalEngaged); }
  if (updates.totalDismissed !== undefined) { sets.push('total_dismissed = ?'); params.push(updates.totalDismissed); }
  if (updates.lastProactiveAt !== undefined) { sets.push('last_proactive_at = ?'); params.push(updates.lastProactiveAt); }
  if (updates.lastUserMsgAt !== undefined) { sets.push('last_user_msg_at = ?'); params.push(updates.lastUserMsgAt); }
  if (updates.mutedUntil !== undefined) { sets.push('muted_until = ?'); params.push(updates.mutedUntil); }
  if (updates.stylePreference !== undefined) { sets.push('style_preference = ?'); params.push(updates.stylePreference); }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  d.prepare(`UPDATE proactive_profile SET ${sets.join(', ')} WHERE id = 1`).run(...params);
}

// ─── Engagement Events ──────────────────────────────────────────────

interface EventRow {
  id: string;
  trigger_type: string;
  signal_types: string;
  message: string;
  channel: string;
  outcome: string;
  user_responded: number;
  response_time_s: number | null;
  sentiment: string | null;
  created_at: string;
  resolved_at: string | null;
}

function rowToEvent(row: EventRow): EngagementEvent {
  return {
    id: row.id,
    triggerType: row.trigger_type as TriggerType,
    signalTypes: JSON.parse(row.signal_types) as SignalType[],
    message: row.message,
    channel: row.channel,
    outcome: row.outcome as EngagementOutcome,
    userResponded: row.user_responded === 1,
    responseTimeS: row.response_time_s,
    sentiment: row.sentiment as Sentiment | null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export function recordEngagementEvent(
  triggerType: TriggerType,
  signalTypes: SignalType[],
  message: string,
  channel: string,
): string {
  const d = getDb();
  const id = randomUUID();
  d.prepare(
    `INSERT INTO proactive_events (id, trigger_type, signal_types, message, channel)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, triggerType, JSON.stringify(signalTypes), message, channel);

  // Update profile
  const profile = getProfile();
  updateProfile({
    totalSent: profile.totalSent + 1,
    lastProactiveAt: new Date().toISOString(),
  });

  log('debug', 'Engagement event recorded', { id, triggerType, channel });
  return id;
}

export function getPendingEvents(windowMinutes: number): EngagementEvent[] {
  const d = getDb();
  const rows = d.prepare(
    `SELECT * FROM proactive_events
     WHERE outcome = 'pending'
       AND created_at > datetime('now', ? || ' minutes')
     ORDER BY created_at DESC`
  ).all(`-${windowMinutes}`) as EventRow[];
  return rows.map(rowToEvent);
}

export function getExpiredPendingEvents(windowMinutes: number): EngagementEvent[] {
  const d = getDb();
  const rows = d.prepare(
    `SELECT * FROM proactive_events
     WHERE outcome = 'pending'
       AND created_at <= datetime('now', ? || ' minutes')
     ORDER BY created_at ASC`
  ).all(`-${windowMinutes}`) as EventRow[];
  return rows.map(rowToEvent);
}

export function resolveEvent(
  eventId: string,
  outcome: EngagementOutcome,
  sentiment: Sentiment | null,
  responseTimeS: number | null,
): void {
  const d = getDb();
  d.prepare(
    `UPDATE proactive_events
     SET outcome = ?, user_responded = ?, sentiment = ?, response_time_s = ?, resolved_at = datetime('now')
     WHERE id = ?`
  ).run(outcome, outcome === 'correct_detection' ? 1 : 0, sentiment, responseTimeS, eventId);

  // Update profile counters
  const profile = getProfile();
  if (outcome === 'correct_detection') {
    updateProfile({ totalEngaged: profile.totalEngaged + 1 });
  } else if (outcome === 'false_alarm') {
    updateProfile({ totalDismissed: profile.totalDismissed + 1 });
  }

  // Recalculate engagement score
  updateEngagementScore();

  log('debug', 'Engagement event resolved', { eventId, outcome, sentiment });
}

export function getRecentEvents(limit = 20): EngagementEvent[] {
  const d = getDb();
  const rows = d.prepare(
    'SELECT * FROM proactive_events ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as EventRow[];
  return rows.map(rowToEvent);
}

// ─── Adaptive Threshold ─────────────────────────────────────────────

export function computeAdaptiveThreshold(
  profile: EngagementProfile,
  range: { min: number; max: number },
): number {
  // Cold start: not enough evidence to judge engagement rate. Use the midpoint
  // instead of the strictest value so the system actually fires for new users.
  if (profile.totalSent < 5) return (range.min + range.max) / 2;

  const engagementRate = profile.totalEngaged / profile.totalSent;
  // High engagement → lower threshold → more proactive
  // Low engagement → higher threshold → less proactive
  return range.max - engagementRate * (range.max - range.min);
}

function updateEngagementScore(): void {
  const profile = getProfile();
  const engagementRate = profile.totalEngaged / Math.max(profile.totalSent, 1);
  updateProfile({ engagementScore: engagementRate });
}

// ─── Activity Pattern ───────────────────────────────────────────────

export function recordActivityHour(timezone: string): void {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone });
  const hour = Number(formatter.format(now));

  const profile = getProfile();
  const pattern = [...profile.activityPattern];
  pattern[hour] = (pattern[hour] ?? 0) + 1;
  updateProfile({
    activityPattern: pattern,
    lastUserMsgAt: now.toISOString(),
  });
}

// ─── Average Response Time ──────────────────────────────────────────

export function updateAvgResponseTime(newResponseTimeS: number): void {
  const profile = getProfile();
  const prevAvg = profile.avgResponseTimeS ?? newResponseTimeS;
  // Exponential moving average (alpha=0.3)
  const alpha = 0.3;
  const updated = alpha * newResponseTimeS + (1 - alpha) * prevAvg;
  updateProfile({ avgResponseTimeS: updated });
}
