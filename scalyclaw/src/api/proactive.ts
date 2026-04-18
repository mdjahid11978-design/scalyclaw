import type { FastifyInstance } from 'fastify';
import { getConfigRef } from '../core/config.js';
import { getDb } from '../core/db.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { getRedis } from '@scalyclaw/shared/core/redis.js';
import { PROACTIVE_COOLDOWN_KEY_PREFIX, PROACTIVE_DAILY_KEY } from '../const/constants.js';
import { runDeepEvaluation } from '../proactive/engine.js';
import { detectAllSignals } from '../proactive/signals.js';
import { getProfile, updateProfile, getRecentEvents } from '../proactive/tracker.js';
import type { StylePreference } from '../proactive/types.js';

export function registerProactiveRoutes(server: FastifyInstance): void {
  // GET /api/proactive/status
  server.get('/api/proactive/status', async () => {
    const config = getConfigRef();
    const redis = getRedis();
    const db = getDb();

    // Count recent proactive messages (last 24h)
    const recentMessages = db.prepare(
      `SELECT COUNT(*) as count FROM messages
       WHERE json_extract(metadata, '$.source') = 'proactive'
         AND created_at > datetime('now', '-1 day')`
    ).get() as { count: number };

    // Daily counter
    const dailyCount = await redis.get(PROACTIVE_DAILY_KEY);

    // Engagement profile
    const profile = getProfile();

    // Cooldown status per trigger type
    const triggerTypes = ['urgent', 'deliverable', 'follow_up', 'insight', 'check_in'] as const;
    const cooldowns: Record<string, boolean> = {};
    for (const t of triggerTypes) {
      cooldowns[t] = (await redis.exists(`${PROACTIVE_COOLDOWN_KEY_PREFIX}${t}`)) === 1;
    }

    return {
      enabled: config.proactive.enabled,
      recentMessageCount: recentMessages.count,
      dailyCount: dailyCount ? Number(dailyCount) : 0,
      maxPerDay: config.proactive.rateLimits.maxPerDay,
      cooldowns,
      profile: {
        engagementScore: profile.engagementScore,
        totalSent: profile.totalSent,
        totalEngaged: profile.totalEngaged,
        totalDismissed: profile.totalDismissed,
        stylePreference: profile.stylePreference,
        lastProactiveAt: profile.lastProactiveAt,
        lastUserMsgAt: profile.lastUserMsgAt,
        mutedUntil: profile.mutedUntil,
      },
    };
  });

  // GET /api/proactive/profile
  server.get('/api/proactive/profile', async () => {
    return getProfile();
  });

  // PATCH /api/proactive/profile
  server.patch<{ Body: { stylePreference?: string } }>('/api/proactive/profile', async (req) => {
    const { stylePreference } = req.body ?? {};
    if (stylePreference && ['minimal', 'balanced', 'proactive'].includes(stylePreference)) {
      updateProfile({ stylePreference: stylePreference as StylePreference });
    }
    return getProfile();
  });

  // POST /api/proactive/mute
  server.post<{ Body: { minutes?: number } }>('/api/proactive/mute', async (req) => {
    const minutes = req.body?.minutes ?? 60;
    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    updateProfile({ mutedUntil: until });
    return { muted: true, until };
  });

  // POST /api/proactive/unmute
  server.post('/api/proactive/unmute', async () => {
    updateProfile({ mutedUntil: null });
    return { muted: false };
  });

  // GET /api/proactive/history
  server.get<{ Querystring: { limit?: string } }>('/api/proactive/history', async (req) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    return getRecentEvents(limit);
  });

  // POST /api/proactive/trigger — manual smoke test
  server.post('/api/proactive/trigger', async () => {
    const config = getConfigRef();

    const signals = await detectAllSignals(config.proactive);
    if (signals.length === 0) {
      return { triggered: 0, message: 'No signals detected' };
    }

    const result = await runDeepEvaluation();
    if (!result) {
      return { triggered: 0, message: 'Evaluation decided not to engage or all deliveries failed' };
    }

    log('info', 'Proactive message sent (manual trigger)', {
      triggerType: result.triggerType,
      deliveredChannels: result.deliveredChannels,
      failedChannels: result.failedChannels,
    });

    return {
      triggered: result.deliveredChannels.length,
      result: {
        deliveredChannels: result.deliveredChannels,
        failedChannels: result.failedChannels,
        triggerType: result.triggerType,
        messagePreview: result.message.substring(0, 100),
      },
    };
  });
}
