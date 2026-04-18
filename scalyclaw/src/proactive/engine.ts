import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { getConfigRef } from '../core/config.js';
import { storeMessage } from '../core/db.js';
import { sendToChannel, getAllAdapters } from '../channels/manager.js';
import { enqueueJob } from '@scalyclaw/shared/queue/queue.js';
import { PROACTIVE_COOLDOWN_KEY_PREFIX, PROACTIVE_DAILY_KEY, PROACTIVE_SIGNALS_KEY } from '../const/constants.js';
import { detectAllSignals, aggregateSignals } from './signals.js';
import { isGoodTime, secondsUntilMidnight } from './timing.js';
import { assembleContext } from './context.js';
import { evaluateAndGenerate } from './evaluator.js';
import {
  getProfile, recordEngagementEvent, getPendingEvents,
  getExpiredPendingEvents, resolveEvent, recordActivityHour,
  computeAdaptiveThreshold, updateAvgResponseTime,
} from './tracker.js';
import type { TriggerType } from './types.js';

// ─── Rate Limit Helpers ─────────────────────────────────────────────

async function checkCooldown(triggerType: TriggerType): Promise<boolean> {
  const redis = getRedis();
  const key = `${PROACTIVE_COOLDOWN_KEY_PREFIX}${triggerType}`;
  return (await redis.exists(key)) === 1;
}

async function setCooldown(triggerType: TriggerType, seconds: number): Promise<void> {
  const redis = getRedis();
  const key = `${PROACTIVE_COOLDOWN_KEY_PREFIX}${triggerType}`;
  await redis.setex(key, seconds, '1');
}

async function checkDailyCap(maxPerDay: number): Promise<boolean> {
  const redis = getRedis();
  const count = await redis.get(PROACTIVE_DAILY_KEY);
  return count !== null && Number(count) >= maxPerDay;
}

async function incrementDailyCounter(timezone: string): Promise<void> {
  const redis = getRedis();
  const count = await redis.incr(PROACTIVE_DAILY_KEY);
  if (count === 1) {
    await redis.expire(PROACTIVE_DAILY_KEY, secondsUntilMidnight(timezone));
  }
}

// ─── Signal Scan (cron entry point, no LLM) ─────────────────────────

export async function runSignalScan(): Promise<void> {
  const config = getConfigRef();
  const proactive = config.proactive;

  if (!proactive.enabled) {
    log('debug', 'Proactive engagement disabled');
    return;
  }

  // Resolve expired pending engagement events (e.g. no response within window)
  const windowMinutes = proactive.engagement.responseWindowMinutes;
  const expired = getExpiredPendingEvents(windowMinutes);
  for (const event of expired) {
    resolveEvent(event.id, 'false_alarm', null, null);
    log('debug', 'Expired pending engagement event', { eventId: event.id });
  }

  const signals = await detectAllSignals(proactive);
  if (signals.length === 0) {
    log('debug', 'Proactive scan: no signals detected');
    return;
  }

  const trigger = aggregateSignals(signals, proactive.triggerWeights);
  if (!trigger) {
    log('debug', 'Proactive scan: no trigger formed');
    return;
  }

  log('debug', 'Proactive scan: trigger formed', {
    type: trigger.type,
    strength: trigger.aggregateStrength.toFixed(2),
    signals: trigger.signals.map(s => s.type),
  });

  const profile = getProfile();
  const threshold = computeAdaptiveThreshold(profile, proactive.engagement.adaptiveRange);
  if (trigger.aggregateStrength < threshold) {
    log('debug', 'Proactive scan: below adaptive threshold', {
      strength: trigger.aggregateStrength.toFixed(2),
      threshold: threshold.toFixed(2),
    });
    return;
  }

  const timing = isGoodTime(profile, proactive, trigger.type);
  if (!timing.ok) {
    if (timing.suggestedDelayMinutes) {
      const redis = getRedis();
      await redis.setex(PROACTIVE_SIGNALS_KEY, timing.suggestedDelayMinutes * 60, JSON.stringify(signals));
      log('debug', 'Proactive scan: delayed', { reason: timing.reason, delayMin: timing.suggestedDelayMinutes });
    } else {
      log('debug', 'Proactive scan: timing not good', { reason: timing.reason });
    }
    return;
  }

  await enqueueJob({
    name: 'proactive-eval',
    data: {},
    opts: { attempts: 1 },
  });

  log('info', 'Proactive eval job enqueued', { triggerType: trigger.type, signalCount: signals.length });
}

// ─── Deep Evaluation (queue job, uses LLM) ──────────────────────────

export interface ProactiveResult {
  deliveredChannels: string[];
  failedChannels: string[];
  message: string;
  triggerType: TriggerType;
}

/**
 * Deep evaluation: re-derive signals, single-call LLM eval+generate, then
 * broadcast to every connected channel adapter. Rate limits, daily counter,
 * engagement event, and profile updates are applied **after** at least one
 * successful delivery.
 */
export async function runDeepEvaluation(): Promise<ProactiveResult | null> {
  const config = getConfigRef();
  const proactive = config.proactive;

  const signals = await detectAllSignals(proactive);
  if (signals.length === 0) {
    log('debug', 'Deep eval: signals cleared since scan');
    return null;
  }

  const trigger = aggregateSignals(signals, proactive.triggerWeights);
  if (!trigger) return null;

  const cooldownConfig = proactive.rateLimits.cooldownSeconds;
  if (await checkCooldown(trigger.type)) {
    log('debug', 'Deep eval: on cooldown', { triggerType: trigger.type });
    return null;
  }

  const maxDaily = trigger.type === 'urgent' ? proactive.rateLimits.maxUrgentPerDay : proactive.rateLimits.maxPerDay;
  if (await checkDailyCap(maxDaily)) {
    log('debug', 'Deep eval: daily cap reached');
    return null;
  }

  // Resolve channels: broadcast to every connected adapter. No "best channel"
  // invention — adapters are registered only for enabled channels + gateway,
  // so this is the intended target set.
  const adapters = getAllAdapters();
  if (adapters.length === 0) {
    log('warn', 'Deep eval: no channel adapters available — nothing to send to');
    return null;
  }

  const context = await assembleContext(trigger);
  const result = await evaluateAndGenerate(context);
  log('info', 'Proactive eval result', {
    engage: result.engage,
    triggerType: result.triggerType,
    reasoning: result.reasoning,
  });

  if (!result.engage || !result.message) return null;

  // Broadcast to every channel in parallel. One adapter failing must not
  // silently eat bookkeeping for the rest.
  const deliveredChannels: string[] = [];
  const failedChannels: string[] = [];

  const sendResults = await Promise.allSettled(
    adapters.map(a => sendToChannel(a.id, result.message!).then(() => a.id)),
  );

  for (let i = 0; i < sendResults.length; i++) {
    const r = sendResults[i];
    const channelId = adapters[i].id;
    if (r.status === 'fulfilled') {
      deliveredChannels.push(channelId);
    } else {
      failedChannels.push(channelId);
      log('warn', 'Proactive delivery failed for channel', { channelId, error: String(r.reason) });
    }
  }

  if (deliveredChannels.length === 0) {
    log('error', 'Proactive delivery failed on every channel', { failedChannels });
    return null;
  }

  // Delivery succeeded somewhere. Apply bookkeeping exactly once.
  const signalTypes = trigger.signals.map(s => s.type);
  const cooldownSecs = cooldownConfig[result.triggerType] ?? cooldownConfig.check_in;
  await setCooldown(result.triggerType, cooldownSecs);
  await incrementDailyCounter(proactive.quietHours.timezone);

  // Record one engagement event per delivered channel so per-channel response
  // tracking works (the user may respond on Telegram while we stay pending on
  // Discord, etc.).
  for (const channelId of deliveredChannels) {
    recordEngagementEvent(result.triggerType, signalTypes, result.message, channelId);
    storeMessage(channelId, 'assistant', result.message, {
      source: 'proactive',
      triggerType: result.triggerType,
    });
  }

  log('info', 'Proactive message delivered', {
    triggerType: result.triggerType,
    deliveredChannels,
    failedChannels,
  });

  return {
    deliveredChannels,
    failedChannels,
    message: result.message,
    triggerType: result.triggerType,
  };
}

// ─── User Message Hook ──────────────────────────────────────────────

export function onUserMessage(channelId: string, text: string): void {
  try {
    const config = getConfigRef();
    if (!config.proactive.enabled) return;

    const timezone = config.proactive.quietHours.timezone;
    recordActivityHour(timezone);

    const windowMinutes = config.proactive.engagement.responseWindowMinutes;
    const pending = getPendingEvents(windowMinutes);

    // Resolve the pending engagement event for THIS channel (per-channel tracking).
    const forThisChannel = pending.find(e => e.channel === channelId);
    if (!forThisChannel) return;

    const responseTimeS = Math.round((Date.now() - new Date(forThisChannel.createdAt).getTime()) / 1000);
    const sentiment = classifySentiment(text);

    resolveEvent(forThisChannel.id, 'correct_detection', sentiment, responseTimeS);
    updateAvgResponseTime(responseTimeS);

    log('debug', 'Engagement event resolved by user message', {
      eventId: forThisChannel.id,
      channelId,
      responseTimeS,
      sentiment,
    });
  } catch (err) {
    log('warn', 'onUserMessage hook failed', { error: String(err) });
  }
}

// ─── Simple Sentiment Heuristic ─────────────────────────────────────

function classifySentiment(userText: string): 'positive' | 'neutral' | 'negative' {
  const lower = userText.toLowerCase().trim();

  const negatives = ['stop', 'shut up', "don't", 'no thanks', 'not now', 'leave me alone', 'be quiet', 'annoying'];
  if (negatives.some(n => lower.includes(n))) return 'negative';

  const positives = ['thanks', 'yes', 'great', 'good', 'nice', 'perfect', 'tell me more', 'interesting', 'helpful'];
  if (positives.some(p => lower.includes(p))) return 'positive';

  if (lower.length > 20) return 'positive';

  return 'neutral';
}
