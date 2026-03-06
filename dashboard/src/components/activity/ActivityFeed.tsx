import { useRef, useEffect, useState } from 'react';
import {
  MessageSquare,
  Brain,
  Wrench,
  Zap,
  Bot,
  Database,
  Send,
  AlertCircle,
  Clock,
  CheckCircle,
} from 'lucide-react';

export interface ActivityEvent {
  id: string;
  time: Date;
  type: 'message' | 'thinking' | 'tool' | 'skill' | 'agent' | 'memory' | 'response' | 'error' | 'proactive' | 'completed';
  description: string;
}

const TYPE_CONFIG: Record<
  ActivityEvent['type'],
  { icon: React.ElementType; color: string; dotColor: string }
> = {
  message: { icon: MessageSquare, color: 'text-blue-400', dotColor: 'bg-blue-400' },
  thinking: { icon: Brain, color: 'text-emerald-400', dotColor: 'bg-emerald-400' },
  tool: { icon: Wrench, color: 'text-cyan-400', dotColor: 'bg-cyan-400' },
  skill: { icon: Zap, color: 'text-purple-400', dotColor: 'bg-purple-400' },
  agent: { icon: Bot, color: 'text-orange-400', dotColor: 'bg-orange-400' },
  memory: { icon: Database, color: 'text-pink-400', dotColor: 'bg-pink-400' },
  response: { icon: Send, color: 'text-green-400', dotColor: 'bg-green-400' },
  error: { icon: AlertCircle, color: 'text-red-400', dotColor: 'bg-red-400' },
  proactive: { icon: Clock, color: 'text-amber-400', dotColor: 'bg-amber-400' },
  completed: { icon: CheckCircle, color: 'text-zinc-400', dotColor: 'bg-zinc-400' },
};

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface ActivityFeedProps {
  events: ActivityEvent[];
}

export function ActivityFeed({ events }: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!hovered && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, hovered]);

  return (
    <div
      className="glass-panel flex h-full flex-col rounded-l-xl"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="border-b border-white/5 px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-400/80">
          Activity Feed
        </h2>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-1">
        {events.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            Waiting for activity...
          </div>
        )}
        {events.map((ev) => {
          const cfg = TYPE_CONFIG[ev.type];
          const Icon = cfg.icon;
          return (
            <div
              key={ev.id}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.03]"
              style={{ animation: 'slide-in 0.3s ease-out' }}
            >
              <span className="mt-0.5 shrink-0 font-mono text-[10px] text-zinc-600">
                {formatTime(ev.time)}
              </span>
              <div className={`mt-0.5 ${cfg.dotColor} h-1.5 w-1.5 shrink-0 rounded-full`} />
              <Icon className={`mt-0.5 h-3 w-3 shrink-0 ${cfg.color}`} />
              <span className="min-w-0 truncate text-xs text-zinc-300">{ev.description}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
