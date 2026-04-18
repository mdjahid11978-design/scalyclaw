// ─── Trigger Types ──────────────────────────────────────────────────

export type TriggerType = 'urgent' | 'deliverable' | 'insight' | 'check_in';

export type SignalType =
  | 'idle'
  | 'pending_deliverable'
  | 'time_sensitive'
  | 'entity_trigger'
  | 'user_pattern'
  | 'return_from_absence';

export type EngagementOutcome = 'correct_detection' | 'false_alarm' | 'pending';
export type Sentiment = 'positive' | 'neutral' | 'negative';
export type StylePreference = 'minimal' | 'balanced' | 'proactive';

// ─── Signals ────────────────────────────────────────────────────────

export interface Signal {
  type: SignalType;
  strength: number;         // 0-1
  metadata: Record<string, unknown>;
}

export interface Trigger {
  type: TriggerType;
  signals: Signal[];
  aggregateStrength: number; // weighted sum
}

// ─── Engagement Events ──────────────────────────────────────────────

export interface EngagementEvent {
  id: string;
  triggerType: TriggerType;
  signalTypes: SignalType[];
  message: string;
  channel: string;
  outcome: EngagementOutcome;
  userResponded: boolean;
  responseTimeS: number | null;
  sentiment: Sentiment | null;
  createdAt: string;
  resolvedAt: string | null;
}

// ─── Engagement Profile ─────────────────────────────────────────────

export interface EngagementProfile {
  engagementScore: number;       // 0-1
  activityPattern: number[];     // 24-element array (hourly counts)
  avgResponseTimeS: number | null;
  totalSent: number;
  totalEngaged: number;
  totalDismissed: number;
  lastProactiveAt: string | null;
  lastUserMsgAt: string | null;
  mutedUntil: string | null;
  stylePreference: StylePreference;
  updatedAt: string;
}

// ─── LLM Evaluation + Generation (merged) ──────────────────────────

export interface EvaluationResult {
  engage: boolean;
  triggerType: TriggerType;
  message: string | null;   // null when engage=false
  reasoning: string;
}

// ─── Context Assembly ───────────────────────────────────────────────

export interface ProactiveContext {
  recentMessages: Array<{ role: string; content: string; channel: string; createdAt: string }>;
  memories: Array<{ subject: string; content: string; type: string; importance: number }>;
  entityGraph: Array<{ name: string; type: string; relations: Array<{ relation: string; target: string }> }>;
  temporalMemories: Array<{ subject: string; content: string }>;
  pendingDeliverables: Array<{ content: string; source: string }>;
  profile: EngagementProfile;
  identity: string;
  currentTime: string;
  trigger: Trigger;
}

// ─── Timing ─────────────────────────────────────────────────────────

export type WorkflowPhase = 'active' | 'post_task' | 'idle' | 'deep_idle';

export interface TimingResult {
  ok: boolean;
  reason: string;
  phase: WorkflowPhase;
  suggestedDelayMinutes?: number;
}
