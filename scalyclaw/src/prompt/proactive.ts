import type { ProactiveContext } from '../proactive/types.js';

/**
 * Single merged prompt for proactive engagement. The model either decides not
 * to engage (returns `{engage: false, reasoning}`) or produces the ready-to-send
 * message in one shot (`{engage: true, triggerType, message}`). This halves LLM
 * cost vs. a two-stage evaluate-then-generate pipeline.
 */
export function buildProactivePrompt(ctx: ProactiveContext): { system: string; user: string } {
  const system = `You decide whether ScalyClaw should send a proactive message right now and, if so, write it.

Identity context:
${ctx.identity || '(not configured)'}

Engagement profile:
- Total proactive sent: ${ctx.profile.totalSent}
- Total engaged: ${ctx.profile.totalEngaged}
- Total dismissed: ${ctx.profile.totalDismissed}
- Engagement score: ${ctx.profile.engagementScore.toFixed(2)} (0=never responds, 1=always)
- Style preference: ${ctx.profile.stylePreference}
- Last proactive: ${ctx.profile.lastProactiveAt ?? 'never'}

Decide:
1. Is there a genuinely useful, non-obvious thing to surface now?
2. Would it feel natural (not noisy) given the engagement profile?
3. Has this same content already been sent recently?
4. Would a quiet non-response be better?

If you decide to engage, the message you write will be delivered to every enabled channel. Keep it:
- 1–3 sentences, concise, natural.
- No greetings ("Hey!", "Hi there!"). No meta-talk about being proactive or checking in. No apologies.
- Reference specific facts from the provided context. Never fabricate.
- Match style preference: ${ctx.profile.stylePreference}.
- If there are pending results (task / reminder outputs), summarize them directly.

Respond with **valid JSON only**, matching one of these two shapes:

{
  "engage": false,
  "reasoning": "brief explanation of why it is better to stay quiet"
}

{
  "engage": true,
  "triggerType": "urgent" | "deliverable" | "insight" | "check_in",
  "message": "the ready-to-send message text",
  "reasoning": "brief explanation of the choice"
}

No prose outside the JSON. No markdown fences.`;

  const parts: string[] = [];
  parts.push(`Current time: ${ctx.currentTime}`);
  parts.push(`Detected trigger: ${ctx.trigger.type} (strength: ${ctx.trigger.aggregateStrength.toFixed(2)})`);
  parts.push(`Signals: ${ctx.trigger.signals.map(s => `${s.type}(${s.strength.toFixed(2)})`).join(', ')}`);

  if (ctx.recentMessages.length > 0) {
    const formatted = ctx.recentMessages.slice(-10).map(m => `[${m.role}] ${m.content}`).join('\n');
    parts.push(`Recent conversation (all channels):\n${formatted}`);
  } else {
    parts.push('No recent conversation.');
  }

  if (ctx.pendingDeliverables.length > 0) {
    const formatted = ctx.pendingDeliverables.map(d => `[${d.source}] ${d.content}`).join('\n');
    parts.push(`Pending deliverables (not yet surfaced):\n${formatted}`);
  }

  if (ctx.memories.length > 0) {
    const formatted = ctx.memories.map(m => `[${m.type}, importance=${m.importance}] ${m.subject}: ${m.content.slice(0, 200)}`).join('\n');
    parts.push(`Relevant memories:\n${formatted}`);
  }

  if (ctx.temporalMemories.length > 0) {
    const formatted = ctx.temporalMemories.map(m => `${m.subject}: ${m.content.slice(0, 200)}`).join('\n');
    parts.push(`Time-sensitive memories:\n${formatted}`);
  }

  if (ctx.entityGraph.length > 0) {
    const formatted = ctx.entityGraph.slice(0, 5).map(e =>
      `${e.name} (${e.type})${e.relations.length > 0 ? ': ' + e.relations.slice(0, 3).map(r => `${r.relation} → ${r.target}`).join(', ') : ''}`
    ).join('\n');
    parts.push(`Entity context:\n${formatted}`);
  }

  parts.push('Respond with JSON only.');

  return { system, user: parts.join('\n\n') };
}
