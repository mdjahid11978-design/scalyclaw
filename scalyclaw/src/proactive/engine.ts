import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { getConfigRef } from '../core/config.js';
import { storeMessage } from '../core/db.js';
import { sendToChannel } from '../channels/manager.js';
import { publishProgress } from '../queue/progress.js';
import { enqueueJob } from '@scalyclaw/shared/queue/queue.js';
import { PROACTIVE_COOLDOWN_KEY_PREFIX, PROACTIVE_DAILY_KEY, PROACTIVE_SIGNALS_KEY } from '../const/constants.js';
import { detectAllSignals, aggregateSignals, findBestChannel, expireOldTopics } from './signals.js';
import { isGoodTime, secondsUntilMidnight } from './timing.js';
import { assembleContext } from './context.js';
import { evaluateShouldEngage, generateMessage } from './evaluator.js';
import {
  getProfile, recordEngagementEvent, getPendingEvents,
  getExpiredPendingEvents, resolveEvent, recordActivityHour,
  computeAdaptiveThreshold, updateAvgResponseTime, updateProfile,
} from './tracker.js';
import type { Signal, TriggerType } from './types.js';

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

  // 1. Resolve expired pending engagement events
  const windowMinutes = proactive.engagement.responseWindowMinutes;
  const expired = getExpiredPendingEvents(windowMinutes);
  for (const event of expired) {
    resolveEvent(event.id, 'false_alarm', null, null);
    log('debug', 'Expired pending engagement event', { eventId: event.id });
  }

  // 2. Expire old topics
  expireOldTopics(proactive.signals.topicExpiryHours);

  // 3. Detect all signals (no LLM)
  const signals = await detectAllSignals(proactive);
  if (signals.length === 0) {
    log('debug', 'Proactive scan: no signals detected');
    return;
  }

  // 4. Aggregate into trigger
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

  // 5. Check adaptive threshold
  const profile = getProfile();
  const threshold = computeAdaptiveThreshold(profile, proactive.engagement.adaptiveRange);
  if (trigger.aggregateStrength < threshold) {
    log('debug', 'Proactive scan: below adaptive threshold', {
      strength: trigger.aggregateStrength.toFixed(2),
      threshold: threshold.toFixed(2),
    });
    return;
  }

  // 6. Check timing
  const timing = isGoodTime(profile, proactive, trigger.type);
  if (!timing.ok) {
    if (timing.suggestedDelayMinutes) {
      // Buffer signals for later
      const redis = getRedis();
      await redis.setex(PROACTIVE_SIGNALS_KEY, timing.suggestedDelayMinutes * 60, JSON.stringify(signals));
      log('debug', 'Proactive scan: delayed', { reason: timing.reason, delayMin: timing.suggestedDelayMinutes });
    } else {
      log('debug', 'Proactive scan: timing not good', { reason: timing.reason });
    }
    return;
  }

  // 7. Enqueue deep evaluation job
  await enqueueJob({
    name: 'proactive-eval',
    data: { signals },
    opts: { attempts: 1 },
  });

  log('info', 'Proactive eval job enqueued', { triggerType: trigger.type, signalCount: signals.length });
}

// ─── Deep Evaluation (queue job, uses LLM) ──────────────────────────

export interface ProactiveResult {
  channelId: string;
  message: string;
  triggerType: TriggerType;
}

export async function runDeepEvaluation(incomingSignals: Signal[]): Promise<ProactiveResult | null> {
  const config = getConfigRef();
  const proactive = config.proactive;

  // 1. Re-detect signals (may have changed since scan)
  const signals = await detectAllSignals(proactive);
  if (signals.length === 0) {
    log('debug', 'Deep eval: signals cleared since scan');
    return null;
  }

  const trigger = aggregateSignals(signals, proactive.triggerWeights);
  if (!trigger) return null;

  // 2. Re-check rate limits
  const cooldownConfig = proactive.rateLimits.cooldownSeconds;
  if (await checkCooldown(trigger.type)) {
    log('debug', 'Deep eval: on cooldown', { triggerType: trigger.type });
    return null;
  }

  // Daily cap: urgent uses separate cap
  const maxDaily = trigger.type === 'urgent' ? proactive.rateLimits.maxUrgentPerDay : proactive.rateLimits.maxPerDay;
  if (await checkDailyCap(maxDaily)) {
    log('debug', 'Deep eval: daily cap reached');
    return null;
  }

  // 3. Assemble context
  const context = await assembleContext(trigger);

  // 4. Phase 1: LLM evaluation
  const evalResult = await evaluateShouldEngage(context);
  log('info', 'Proactive eval result', {
    engage: evalResult.engage,
    triggerType: evalResult.triggerType,
    confidence: evalResult.confidence,
    reasoning: evalResult.reasoning,
  });

  if (!evalResult.engage) return null;

  // 5. Phase 2: Generate message
  const message = await generateMessage(context, evalResult.triggerType);
  if (!message) {
    log('debug', 'Deep eval: LLM returned [SKIP]');
    return null;
  }

  // 6. Find best channel for delivery
  const channelId = await findBestChannel();
  if (!channelId) {
    log('warn', 'Deep eval: no channel available for delivery');
    return null;
  }

  // 7. Apply rate limits
  const cooldownSecs = cooldownConfig[evalResult.triggerType] ?? cooldownConfig.check_in;
  await setCooldown(evalResult.triggerType, cooldownSecs);
  await incrementDailyCounter(proactive.quietHours.timezone);

  // 8. Record engagement event
  const signalTypes = trigger.signals.map(s => s.type);
  recordEngagementEvent(evalResult.triggerType, signalTypes, message, channelId);

  // 9. Store & deliver
  storeMessage(channelId, 'assistant', message, {
    source: 'proactive',
    triggerType: evalResult.triggerType,
  });

  try {
    await sendToChannel(channelId, message);
  } catch (err) {
    log('error', 'Failed to send proactive message to channel', { channelId, error: String(err) });
  }

  log('info', 'Proactive message delivered', { channelId, triggerType: evalResult.triggerType });
  return { channelId, message, triggerType: evalResult.triggerType };
}

// ─── User Message Hook ──────────────────────────────────────────────

export function onUserMessage(channelId: string, text: string): void {
  try {
    const config = getConfigRef();
    if (!config.proactive.enabled) return;

    const timezone = config.proactive.quietHours.timezone;

    // 1. Record activity hour in profile
    recordActivityHour(timezone);

    // 2. Resolve pending engagement events
    const windowMinutes = config.proactive.engagement.responseWindowMinutes;
    const pending = getPendingEvents(windowMinutes);

    if (pending.length > 0) {
      const event = pending[0]; // Most recent pending event
      const responseTimeS = Math.round((Date.now() - new Date(event.createdAt).getTime()) / 1000);

      // Simple sentiment heuristic: if user engages with the topic → positive
      // This is a basic heuristic; could be improved with LLM analysis
      const sentiment = classifySentiment(text, event.message);

      resolveEvent(event.id, 'correct_detection', sentiment, responseTimeS);
      updateAvgResponseTime(responseTimeS);

      log('debug', 'Engagement event resolved by user message', {
        eventId: event.id,
        responseTimeS,
        sentiment,
      });
    }
  } catch (err) {
    log('warn', 'onUserMessage hook failed', { error: String(err) });
  }
}

// ─── Simple Sentiment Heuristic ─────────────────────────────────────

function classifySentiment(
  userText: string,
  proactiveMessage: string,
): 'positive' | 'neutral' | 'negative' {
  const lower = userText.toLowerCase().trim();

  // Negative indicators
  const negatives = ['stop', 'shut up', "don't", 'no thanks', 'not now', 'leave me alone', 'be quiet', 'annoying'];
  if (negatives.some(n => lower.includes(n))) return 'negative';

  // Positive indicators (user engages with content)
  const positives = ['thanks', 'yes', 'great', 'good', 'nice', 'perfect', 'tell me more', 'interesting', 'helpful'];
  if (positives.some(p => lower.includes(p))) return 'positive';

  // Check if response is substantive (>20 chars suggests engagement)
  if (lower.length > 20) return 'positive';

  return 'neutral';
}
