import { Activity, DollarSign, Database, Clock, Radio } from 'lucide-react';

interface HudStatsProps {
  tokens: number;
  cost: number;
  memories: number;
  uptime: number; // seconds
  channels: number;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtUptime(s: number): string {
  if (s <= 0) return '-';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function HudStats({ tokens, cost, memories, uptime, channels }: HudStatsProps) {
  const items = [
    { icon: Activity, label: 'Tokens', value: fmtTokens(tokens) },
    { icon: DollarSign, label: 'Cost', value: `$${cost.toFixed(2)}` },
    { icon: Database, label: 'Memories', value: String(memories) },
    { icon: Clock, label: 'Uptime', value: fmtUptime(uptime) },
    { icon: Radio, label: 'Channels', value: String(channels), dot: channels > 0 },
  ];

  return (
    <div className="glass-panel border-t border-white/5 px-4 py-1.5">
      <div className="flex items-center justify-center gap-6">
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-1.5">
            <it.icon className="h-3 w-3 text-zinc-600" />
            <span className="text-[10px] uppercase tracking-wider text-zinc-600">{it.label}</span>
            <span className="font-mono text-xs font-semibold tabular-nums text-zinc-300">
              {it.value}
            </span>
            {it.dot && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
          </div>
        ))}
      </div>
    </div>
  );
}
