import type { ProactiveContext, TriggerType } from '../proactive/types.js';

export function buildGenPrompt(ctx: ProactiveContext, confirmedTriggerType: TriggerType): { system: string; user: string } {
  const system = `You are a proactive engagement module. Your personality and identity:

${ctx.identity || '(not configured)'}

Generate a proactive message for the user. Rules:
- 1-3 sentences maximum
- Be concise and natural
- No greetings like "Hey!" or "Hi there!"
- No meta-talk about being proactive or checking in
- Do not apologize
- Reference specific facts from the provided context
- If there are pending results (tasks, reminders), summarize them naturally
- If the conversation had unfinished topics, follow up on them
- Match the user's style preference: ${ctx.profile.stylePreference}
- Trigger type: ${confirmedTriggerType}
- If there is genuinely nothing meaningful to say, respond with exactly: [SKIP]
- Never fabricate information — only reference what you see in the context`;

  const parts: string[] = [];
  parts.push(`Current time: ${ctx.currentTime}`);

  if (ctx.recentMessages.length > 0) {
    const formatted = ctx.recentMessages.slice(-10).map(m => `[${m.role}] ${m.content}`).join('\n');
    parts.push(`Recent conversation:\n${formatted}`);
  } else {
    parts.push('No recent conversation.');
  }

  if (ctx.pendingDeliverables.length > 0) {
    const formatted = ctx.pendingDeliverables.map(d => `[${d.source}] ${d.content}`).join('\n');
    parts.push(`Pending results (delivered while user was away):\n${formatted}`);
  }

  if (ctx.openTopics.length > 0) {
    parts.push(`Open topics to follow up on: ${ctx.openTopics.map(t => t.topic).join(', ')}`);
  }

  if (ctx.memories.length > 0) {
    const formatted = ctx.memories.map(m => `[${m.type}] ${m.subject}: ${m.content.slice(0, 200)}`).join('\n');
    parts.push(`Relevant memories:\n${formatted}`);
  }

  if (ctx.temporalMemories.length > 0) {
    const formatted = ctx.temporalMemories.map(m => `${m.subject}: ${m.content.slice(0, 200)}`).join('\n');
    parts.push(`Time-sensitive information:\n${formatted}`);
  }

  if (ctx.entityGraph.length > 0) {
    const formatted = ctx.entityGraph.slice(0, 3).map(e =>
      `${e.name} (${e.type})${e.relations.length > 0 ? ': ' + e.relations.slice(0, 3).map(r => `${r.relation} → ${r.target}`).join(', ') : ''}`
    ).join('\n');
    parts.push(`Entity context:\n${formatted}`);
  }

  parts.push('Generate a proactive message, or [SKIP] if nothing meaningful to say.');

  return { system, user: parts.join('\n\n') };
}
