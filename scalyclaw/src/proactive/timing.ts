import type { ScalyClawConfig } from '../core/config.js';
import type { EngagementProfile, TimingResult, TriggerType, WorkflowPhase } from './types.js';

// ─── Workflow Phase Detection (IUI 2026) ────────────────────────────

function detectWorkflowPhase(lastUserMsgAt: string | null): WorkflowPhase {
  if (!lastUserMsgAt) return 'deep_idle';

  const sinceMs = Date.now() - new Date(lastUserMsgAt).getTime();
  const sinceMin = sinceMs / 60_000;

  if (sinceMin < 5) return 'active';
  if (sinceMin < 30) return 'post_task';
  if (sinceMin < 120) return 'idle';
  return 'deep_idle';
}

// ─── Quiet Hours ────────────────────────────────────────────────────

function isQuietHour(qh: ScalyClawConfig['proactive']['quietHours']): boolean {
  if (!qh.enabled) return false;

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: qh.timezone });
  const currentHour = Number(formatter.format(now));

  if (qh.start > qh.end) {
    return currentHour >= qh.start || currentHour < qh.end;
  }
  return currentHour >= qh.start && currentHour < qh.end;
}

// ─── Mute Check ─────────────────────────────────────────────────────

function isMuted(profile: EngagementProfile): boolean {
  if (!profile.mutedUntil) return false;
  return new Date(profile.mutedUntil) > new Date();
}

// ─── Activity Pattern Check ─────────────────────────────────────────

function isLowActivityHour(profile: EngagementProfile, timezone: string): boolean {
  const pattern = profile.activityPattern;
  const total = pattern.reduce((s, v) => s + v, 0);
  if (total < 20) return false; // Not enough data to make judgments

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone });
  const hour = Number(formatter.format(now));
  const hourActivity = pattern[hour] ?? 0;
  const avg = total / 24;

  // Low activity = less than 30% of average
  return hourActivity < avg * 0.3;
}

// ─── Main Timing Check ─────────────────────────────────────────────

export function isGoodTime(
  profile: EngagementProfile,
  config: ScalyClawConfig['proactive'],
  triggerType: TriggerType,
): TimingResult {
  const phase = detectWorkflowPhase(profile.lastUserMsgAt);

  // Active phase — never interrupt
  if (phase === 'active') {
    return { ok: false, reason: 'User is actively engaged', phase, suggestedDelayMinutes: 5 };
  }

  // Mute check — always respected
  if (isMuted(profile)) {
    const remaining = Math.ceil((new Date(profile.mutedUntil!).getTime() - Date.now()) / 60_000);
    return { ok: false, reason: `Muted for ${remaining} more minutes`, phase, suggestedDelayMinutes: remaining };
  }

  // Quiet hours — urgent can override
  if (isQuietHour(config.quietHours)) {
    if (triggerType === 'urgent' && config.quietHours.urgentOverride) {
      // Urgent bypasses quiet hours
    } else {
      return { ok: false, reason: 'Quiet hours active', phase };
    }
  }

  // Low activity hour — delay non-urgent
  if (triggerType !== 'urgent' && isLowActivityHour(profile, config.quietHours.timezone)) {
    return { ok: false, reason: 'Low activity hour based on historical pattern', phase, suggestedDelayMinutes: 30 };
  }

  // Post-task is optimal (52% engagement rate from IUI 2026 study)
  if (phase === 'post_task') {
    return { ok: true, reason: 'Optimal post-task window', phase };
  }

  // Idle and deep_idle are fine
  return { ok: true, reason: `User is ${phase}`, phase };
}

// ─── Seconds Until Midnight ─────────────────────────────────────────

export function secondsUntilMidnight(timezone: string): number {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false, timeZone: timezone,
  });
  const parts = formatter.formatToParts(now);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  const s = Number(parts.find(p => p.type === 'second')?.value ?? 0);
  return Math.max(86400 - (h * 3600 + m * 60 + s), 60);
}
