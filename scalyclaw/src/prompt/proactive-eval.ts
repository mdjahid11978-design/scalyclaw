import type { ProactiveContext } from '../proactive/types.js';

export function buildEvalPrompt(ctx: ProactiveContext): { system: string; user: string } {
  const system = `You are the proactive engagement evaluator. Your job is to decide whether to send a proactive message to the user.

Identity context:
${ctx.identity || '(not configured)'}

The user's engagement profile:
- Engagement score: ${ctx.profile.engagementScore.toFixed(2)} (0=never responds, 1=always responds)
- Style preference: ${ctx.profile.stylePreference}
- Total proactive messages sent: ${ctx.profile.totalSent}
- Total engaged: ${ctx.profile.totalEngaged}
- Total dismissed: ${ctx.profile.totalDismissed}
- Last proactive message: ${ctx.profile.lastProactiveAt ?? 'never'}

Evaluate whether to engage. Consider:
1. Is there genuinely useful information to share?
2. Would this be a good moment (post-task windows are optimal)?
3. Has similar content been sent recently?
4. Does the engagement profile suggest the user wants this kind of engagement?
5. Would the message feel natural and welcome?

Respond with valid JSON only:
{
  "engage": true/false,
  "triggerType": "urgent"|"deliverable"|"follow_up"|"insight"|"check_in",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

  const parts: string[] = [];
  parts.push(`Current time: ${ctx.currentTime}`);
  parts.push(`Trigger type: ${ctx.trigger.type} (strength: ${ctx.trigger.aggregateStrength.toFixed(2)})`);
  parts.push(`Signals: ${ctx.trigger.signals.map(s => `${s.type}(${s.strength.toFixed(2)})`).join(', ')}`);

  if (ctx.recentMessages.length > 0) {
    const formatted = ctx.recentMessages.slice(-10).map(m => `[${m.role}] ${m.content}`).join('\n');
    parts.push(`Recent conversation:\n${formatted}`);
  }

  if (ctx.pendingDeliverables.length > 0) {
    const formatted = ctx.pendingDeliverables.map(d => `[${d.source}] ${d.content}`).join('\n');
    parts.push(`Pending deliverables (user hasn't seen these):\n${formatted}`);
  }

  if (ctx.openTopics.length > 0) {
    parts.push(`Open topics: ${ctx.openTopics.map(t => t.topic).join(', ')}`);
  }

  if (ctx.memories.length > 0) {
    const formatted = ctx.memories.map(m => `[${m.type}, importance=${m.importance}] ${m.subject}: ${m.content.slice(0, 150)}`).join('\n');
    parts.push(`Relevant memories:\n${formatted}`);
  }

  if (ctx.temporalMemories.length > 0) {
    const formatted = ctx.temporalMemories.map(m => `${m.subject}: ${m.content.slice(0, 150)}`).join('\n');
    parts.push(`Time-sensitive memories:\n${formatted}`);
  }

  if (ctx.entityGraph.length > 0) {
    const formatted = ctx.entityGraph.slice(0, 5).map(e =>
      `${e.name} (${e.type})${e.relations.length > 0 ? ': ' + e.relations.slice(0, 3).map(r => `${r.relation} → ${r.target}`).join(', ') : ''}`
    ).join('\n');
    parts.push(`Entity context:\n${formatted}`);
  }

  parts.push('Should we send a proactive message? Respond with JSON only.');

  return { system, user: parts.join('\n\n') };
}
