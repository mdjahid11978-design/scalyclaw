import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { wsClient } from '@/lib/ws';
import {
  getJobs,
  getJobCounts,
  getStatus,
  getBudget,
  getChannels,
  listMemory,
  getUsage,
} from '@/lib/api';
import { GameScene } from '@/components/activity/GameScene';
import { ActivityFeed, type ActivityEvent } from '@/components/activity/ActivityFeed';
import { QueueLanes } from '@/components/activity/QueueLanes';
import { HudStats } from '@/components/activity/HudStats';

// ── Queue colors / labels ──

const Q_COLORS: Record<string, string> = {
  'scalyclaw-messages': '#10b981',
  'scalyclaw-tools': '#3b82f6',
  'scalyclaw-agents': '#8b5cf6',
  'scalyclaw-internal': '#f59e0b',
};
const Q_LABELS: Record<string, string> = {
  'scalyclaw-messages': 'Messages',
  'scalyclaw-tools': 'Tools',
  'scalyclaw-agents': 'Agents',
  'scalyclaw-internal': 'Internal',
};

// ── Helpers ──

function jobEventType(
  name: string,
): ActivityEvent['type'] {
  if (name.includes('message') || name === 'command') return 'message';
  if (name.includes('agent')) return 'agent';
  if (name.includes('skill')) return 'skill';
  if (name.includes('tool') || name.includes('code') || name.includes('command')) return 'tool';
  if (name.includes('memory')) return 'memory';
  if (name.includes('proactive')) return 'proactive';
  return 'tool';
}

let eid = 0;
function mkEvent(type: ActivityEvent['type'], description: string): ActivityEvent {
  return { id: String(++eid), time: new Date(), type, description };
}

function computeScene(jobs: Array<Record<string, unknown>>): {
  target: string;
  speech: string;
  working: boolean;
} {
  if (jobs.length === 0) return { target: 'home', speech: '', working: false };

  const names = jobs.map((j) => String(j.name ?? ''));
  const queues = jobs.map((j) => String(j.queueName ?? ''));

  if (queues.includes('scalyclaw-agents') || names.some((n) => n.includes('agent'))) {
    const agentName = names.find((n) => n.includes('agent'));
    return { target: 'agents', speech: `Delegating${agentName ? `: ${agentName}` : ''}...`, working: true };
  }
  if (names.some((n) => n.includes('skill'))) {
    return { target: 'skills', speech: 'Executing skill...', working: true };
  }
  if (names.some((n) => n.includes('tool') || n.includes('code') || n.includes('command'))) {
    const toolName = names.find((n) => n.includes('tool') || n.includes('code'));
    return { target: 'skills', speech: `Using ${toolName ?? 'tool'}...`, working: true };
  }
  if (names.some((n) => n.includes('message'))) {
    return { target: 'models', speech: 'Thinking...', working: true };
  }
  if (names.some((n) => n.includes('memory'))) {
    return { target: 'memory', speech: 'Searching memory...', working: true };
  }
  if (names.some((n) => n.includes('vault'))) {
    return { target: 'vault', speech: 'Accessing vault...', working: true };
  }
  if (names.some((n) => n.includes('proactive'))) {
    return { target: 'models', speech: 'Proactive check...', working: true };
  }
  return { target: 'home', speech: 'Processing...', working: true };
}

// ── Types ──

type JobRec = Record<string, unknown>;

// ── Page ──

export default function Activity() {
  // Data
  const [activeJobs, setActiveJobs] = useState<JobRec[]>([]);
  const [queueCounts, setQueueCounts] = useState<Record<string, Record<string, number>>>({});
  const [statusData, setStatusData] = useState<Record<string, unknown> | null>(null);
  const [budgetData, setBudgetData] = useState<{ currentMonthCost: number } | null>(null);
  const [channelData, setChannelData] = useState<JobRec[]>([]);
  const [memoryCount, setMemoryCount] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [sleeping, setSleeping] = useState(false);
  const [wsStatus, setWsStatus] = useState(wsClient.status);

  // Refs
  const prevJobIds = useRef(new Set<string>());
  const prevJobMap = useRef(new Map<string, string>());
  const lastActivity = useRef(Date.now());
  const mounted = useRef(true);

  const addEvent = useCallback((type: ActivityEvent['type'], desc: string) => {
    setEvents((prev) => [...prev.slice(-49), mkEvent(type, desc)]);
    lastActivity.current = Date.now();
    setSleeping(false);
  }, []);

  // WebSocket
  useEffect(() => {
    const u1 = wsClient.onStatus(setWsStatus);
    const u2 = wsClient.subscribe((text) =>
      addEvent('response', text.length > 60 ? text.slice(0, 57) + '...' : text),
    );
    const u3 = wsClient.onTyping((a) => {
      if (a) addEvent('thinking', 'Thinking...');
    });
    return () => { u1(); u2(); u3(); };
  }, [addEvent]);

  // Poll jobs 3s
  useEffect(() => {
    mounted.current = true;
    const poll = async () => {
      try {
        const [jr, cr] = await Promise.all([getJobs('active'), getJobCounts()]);
        if (!mounted.current) return;
        const jobs = jr.jobs;
        const curIds = new Set(jobs.map((j) => String(j.id)));
        const curMap = new Map(jobs.map((j) => [String(j.id), String(j.name ?? '')]));
        for (const j of jobs) {
          const id = String(j.id);
          if (!prevJobIds.current.has(id))
            addEvent(jobEventType(String(j.name ?? '')), `Started: ${j.name}`);
        }
        for (const id of prevJobIds.current) {
          if (!curIds.has(id))
            addEvent('completed', `Completed: ${prevJobMap.current.get(id) ?? 'job'}`);
        }
        prevJobIds.current = curIds;
        prevJobMap.current = curMap;
        setActiveJobs(jobs);
        setQueueCounts(cr.counts);
      } catch { /* */ }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => { mounted.current = false; clearInterval(iv); };
  }, [addEvent]);

  // Poll status 5s
  useEffect(() => {
    const poll = async () => {
      try { setStatusData(await getStatus()); } catch { /* */ }
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, []);

  // Poll budget + channels 15s
  useEffect(() => {
    const poll = async () => {
      try {
        const [b, c] = await Promise.all([getBudget(), getChannels()]);
        setBudgetData(b);
        setChannelData(c.channels);
      } catch { /* */ }
    };
    poll();
    const iv = setInterval(poll, 15000);
    return () => clearInterval(iv);
  }, []);

  // Poll memory + usage 30s
  useEffect(() => {
    const poll = async () => {
      try {
        const [m, u] = await Promise.all([listMemory(), getUsage()]);
        setMemoryCount(m.results?.length ?? 0);
        setTokenCount((u.totalInputTokens ?? 0) + (u.totalOutputTokens ?? 0));
      } catch { /* */ }
    };
    poll();
    const iv = setInterval(poll, 30000);
    return () => clearInterval(iv);
  }, []);

  // Sleep detection
  useEffect(() => {
    const iv = setInterval(() => {
      if (activeJobs.length === 0 && Date.now() - lastActivity.current > 60_000) {
        setSleeping(true);
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [activeJobs.length]);

  // Derived scene state
  const scene = useMemo(() => computeScene(activeJobs), [activeJobs]);

  // Notifications per station
  const notifications = useMemo(() => {
    const n: Record<string, number> = {};
    const mc = queueCounts['scalyclaw-messages'] ?? {};
    n.channels = mc.waiting ?? 0;
    const tc = queueCounts['scalyclaw-tools'] ?? {};
    n.skills = (tc.waiting ?? 0) + (tc.active ?? 0);
    const ac = queueCounts['scalyclaw-agents'] ?? {};
    n.agents = (ac.waiting ?? 0) + (ac.active ?? 0);
    const ic = queueCounts['scalyclaw-internal'] ?? {};
    n.memory = ic.waiting ?? 0;
    return n;
  }, [queueCounts]);

  // Queue lanes
  const lanes = ['scalyclaw-messages', 'scalyclaw-tools', 'scalyclaw-agents', 'scalyclaw-internal'].map(
    (name) => {
      const c = queueCounts[name] ?? {};
      return {
        name,
        label: Q_LABELS[name],
        color: Q_COLORS[name],
        active: (c.active ?? 0) + (c.prioritized ?? 0),
        waiting: c.waiting ?? 0,
      };
    },
  );

  const uptime =
    statusData && typeof statusData.uptime === 'number' ? (statusData.uptime as number) : 0;

  const stateLabel = sleeping
    ? 'Sleeping'
    : scene.working
      ? scene.speech.split('...')[0] || 'Working'
      : 'Idle';

  const stateColor = sleeping
    ? 'text-zinc-600'
    : scene.working
      ? 'text-emerald-400'
      : 'text-zinc-500';

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#030303]">
      {/* Header bar */}
      <div className="relative z-20 flex items-center gap-3 px-5 py-2">
        <span
          className={`h-2 w-2 rounded-full ${
            wsStatus === 'connected'
              ? 'bg-emerald-500'
              : wsStatus === 'connecting'
                ? 'animate-pulse bg-amber-500'
                : 'bg-zinc-600'
          }`}
        />
        <span className={`text-xs font-medium ${stateColor}`}>{stateLabel}</span>
      </div>

      {/* Main: scene left, feed right */}
      <div className="relative z-10 flex min-h-0 flex-1">
        <div className="flex-1">
          <GameScene
            target={sleeping ? 'home' : scene.target}
            speech={sleeping ? '' : scene.speech}
            working={scene.working}
            sleeping={sleeping}
            notifications={notifications}
            channels={channelData.map((ch) => ({
              id: String(ch.id ?? ch.type ?? ''),
              enabled: ch.enabled !== false,
            }))}
          />
        </div>
        <div className="w-[34%] min-w-[260px] py-1 pr-1">
          <ActivityFeed events={events} />
        </div>
      </div>

      {/* Queue lanes */}
      <QueueLanes lanes={lanes} />

      {/* HUD */}
      <HudStats
        tokens={tokenCount}
        cost={budgetData?.currentMonthCost ?? 0}
        memories={memoryCount}
        uptime={uptime}
        channels={channelData.filter((c) => c.enabled !== false).length}
      />
    </div>
  );
}
