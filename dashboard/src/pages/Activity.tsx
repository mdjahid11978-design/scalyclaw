import { useState, useEffect, useRef, useCallback } from 'react';
import { Radar } from 'lucide-react';
import { wsClient } from '@/lib/ws';
import { getJobs, getJobCounts, getStatus, getBudget, getChannels, listMemory, getUsage } from '@/lib/api';
import { ParticleCanvas } from '@/components/activity/ParticleCanvas';
import { PixelAvatar, type AvatarState } from '@/components/activity/PixelAvatar';
import { ActivityFeed, type ActivityEvent } from '@/components/activity/ActivityFeed';
import { QueueLanes } from '@/components/activity/QueueLanes';
import { HudStats } from '@/components/activity/HudStats';
import { PulseRing } from '@/components/activity/PulseRing';

const QUEUE_COLORS: Record<string, string> = {
  'scalyclaw-messages': '#10b981',
  'scalyclaw-tools': '#3b82f6',
  'scalyclaw-agents': '#8b5cf6',
  'scalyclaw-internal': '#f59e0b',
};

const QUEUE_LABELS: Record<string, string> = {
  'scalyclaw-messages': 'Messages',
  'scalyclaw-tools': 'Tools',
  'scalyclaw-agents': 'Agents',
  'scalyclaw-internal': 'Internal',
};

function jobEventType(name: string): ActivityEvent['type'] {
  if (name.includes('message') || name === 'command') return 'message';
  if (name.includes('agent')) return 'agent';
  if (name.includes('skill')) return 'skill';
  if (name.includes('tool') || name.includes('code') || name.includes('command')) return 'tool';
  if (name.includes('memory')) return 'memory';
  if (name.includes('proactive')) return 'proactive';
  return 'tool';
}

let eventIdCounter = 0;
function makeEvent(type: ActivityEvent['type'], description: string): ActivityEvent {
  return { id: String(++eventIdCounter), time: new Date(), type, description };
}

type JobRecord = Record<string, unknown>;

export default function Activity() {
  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [pulseCount, setPulseCount] = useState(0);
  const [burstCount, setBurstCount] = useState(0);

  // Data state
  const [activeJobs, setActiveJobs] = useState<JobRecord[]>([]);
  const [queueCounts, setQueueCounts] = useState<Record<string, Record<string, number>>>({});
  const [statusData, setStatusData] = useState<Record<string, unknown> | null>(null);
  const [budgetData, setBudgetData] = useState<{ currentMonthCost: number } | null>(null);
  const [channelData, setChannelData] = useState<JobRecord[]>([]);
  const [memoryCount, setMemoryCount] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [wsStatus, setWsStatus] = useState(wsClient.status);

  // Refs for delta computation
  const prevJobIds = useRef(new Set<string>());
  const prevJobMap = useRef(new Map<string, string>());
  const lastActivity = useRef(Date.now());
  const mounted = useRef(true);

  const addEvent = useCallback((type: ActivityEvent['type'], description: string) => {
    setEvents((prev) => [...prev.slice(-49), makeEvent(type, description)]);
    lastActivity.current = Date.now();
    setPulseCount((n) => n + 1);
    setBurstCount((n) => n + 1);
  }, []);

  // WebSocket events
  useEffect(() => {
    const unStatus = wsClient.onStatus(setWsStatus);
    const unMsg = wsClient.subscribe((text) => {
      addEvent('response', text.length > 60 ? text.slice(0, 57) + '...' : text);
    });
    const unTyping = wsClient.onTyping((active) => {
      if (active) addEvent('thinking', 'Thinking...');
    });
    return () => { unStatus(); unMsg(); unTyping(); };
  }, [addEvent]);

  // Poll jobs (3s)
  useEffect(() => {
    mounted.current = true;
    const poll = async () => {
      try {
        const [jobsRes, countsRes] = await Promise.all([getJobs('active'), getJobCounts()]);
        if (!mounted.current) return;

        const jobs = jobsRes.jobs;
        const currentIds = new Set(jobs.map((j) => String(j.id)));
        const currentMap = new Map(jobs.map((j) => [String(j.id), String(j.name ?? '')]));

        // New jobs
        for (const j of jobs) {
          const id = String(j.id);
          if (!prevJobIds.current.has(id)) {
            const name = String(j.name ?? 'job');
            addEvent(jobEventType(name), `Started: ${name}`);
          }
        }
        // Completed jobs
        for (const id of prevJobIds.current) {
          if (!currentIds.has(id)) {
            const name = prevJobMap.current.get(id) ?? 'job';
            addEvent('completed', `Completed: ${name}`);
          }
        }

        prevJobIds.current = currentIds;
        prevJobMap.current = currentMap;
        setActiveJobs(jobs);
        setQueueCounts(countsRes.counts);
      } catch { /* silent */ }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => { mounted.current = false; clearInterval(iv); };
  }, [addEvent]);

  // Poll status (5s)
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await getStatus();
        setStatusData(data);
      } catch { /* silent */ }
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, []);

  // Poll budget + channels (15s)
  useEffect(() => {
    const poll = async () => {
      try {
        const [b, c] = await Promise.all([getBudget(), getChannels()]);
        setBudgetData(b);
        setChannelData(c.channels);
      } catch { /* silent */ }
    };
    poll();
    const iv = setInterval(poll, 15000);
    return () => clearInterval(iv);
  }, []);

  // Poll memory + usage (30s)
  useEffect(() => {
    const poll = async () => {
      try {
        const [m, u] = await Promise.all([listMemory(), getUsage()]);
        setMemoryCount(m.results?.length ?? 0);
        setTokenCount((u.totalInputTokens ?? 0) + (u.totalOutputTokens ?? 0));
      } catch { /* silent */ }
    };
    poll();
    const iv = setInterval(poll, 30000);
    return () => clearInterval(iv);
  }, []);

  // Derive avatar state
  useEffect(() => {
    const names = activeJobs.map((j) => String(j.name ?? ''));
    const queues = activeJobs.map((j) => String(j.queueName ?? ''));

    if (queues.some((q) => q.includes('agents')) || names.some((n) => n.includes('agent'))) {
      setAvatarState('delegating');
    } else if (
      names.some((n) => n.includes('tool') || n.includes('skill') || n.includes('code') || n.includes('command'))
    ) {
      setAvatarState('working');
    } else if (names.some((n) => n.includes('message') || n === 'command')) {
      setAvatarState('thinking');
    } else if (activeJobs.length > 0) {
      setAvatarState('working');
    } else {
      setAvatarState('idle');
    }
  }, [activeJobs]);

  // Sleep detection (60s no activity)
  useEffect(() => {
    const iv = setInterval(() => {
      if (activeJobs.length === 0 && Date.now() - lastActivity.current > 60_000) {
        setAvatarState('sleeping');
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [activeJobs.length]);

  // Build orbital jobs
  const orbitalJobs = activeJobs.map((j, i) => ({
    id: String(j.id),
    color: QUEUE_COLORS[String(j.queueName)] ?? '#10b981',
    index: i,
    total: activeJobs.length,
  }));

  // Build queue lanes
  const lanes = ['scalyclaw-messages', 'scalyclaw-tools', 'scalyclaw-agents', 'scalyclaw-internal'].map((name) => {
    const counts = queueCounts[name] ?? {};
    return {
      name,
      label: QUEUE_LABELS[name],
      color: QUEUE_COLORS[name],
      active: (counts.active ?? 0) + (counts.prioritized ?? 0),
      waiting: counts.waiting ?? 0,
    };
  });

  const uptime =
    statusData && typeof statusData.uptime === 'number' ? (statusData.uptime as number) : 0;

  const stateLabel =
    avatarState === 'sleeping'
      ? 'Sleeping'
      : avatarState === 'delegating'
        ? 'Delegating'
        : avatarState === 'working'
          ? 'Working'
          : avatarState === 'thinking'
            ? 'Thinking'
            : 'Idle';

  const stateColor =
    avatarState === 'sleeping'
      ? 'text-zinc-500'
      : avatarState === 'delegating'
        ? 'text-purple-400'
        : avatarState === 'working'
          ? 'text-cyan-400'
          : avatarState === 'thinking'
            ? 'text-emerald-400'
            : 'text-zinc-400';

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#030303]">
      {/* Particle background */}
      <ParticleCanvas burstTrigger={burstCount} />

      {/* Header */}
      <header className="relative z-10 flex items-center gap-3 px-5 py-3">
        <Radar className="h-4 w-4 text-emerald-500" />
        <h1 className="text-sm font-semibold text-zinc-200">Neural Activity</h1>
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
      </header>

      {/* Main area: avatar left, feed right */}
      <div className="relative z-10 flex min-h-0 flex-1">
        {/* Left: Avatar area */}
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="relative">
            <PulseRing trigger={pulseCount} />
            <PixelAvatar state={avatarState} orbitalJobs={orbitalJobs} />
          </div>

          {/* Channel portals */}
          {channelData.length > 0 && (
            <div className="mt-10 flex gap-3">
              {channelData.map((ch, i) => {
                const id = String(ch.id ?? ch.type ?? i);
                const enabled = ch.enabled !== false;
                return (
                  <div key={id} className="flex flex-col items-center gap-1">
                    <div
                      className={`h-3 w-3 rounded-full border transition-all ${
                        enabled
                          ? 'border-emerald-500/50 bg-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                          : 'border-zinc-700 bg-zinc-800'
                      }`}
                    />
                    <span className="text-[9px] text-zinc-600">{id}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Activity feed */}
        <div className="w-[38%] min-w-[280px] py-1 pr-1">
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
