interface QueueLaneData {
  name: string;
  label: string;
  color: string;
  active: number;
  waiting: number;
}

interface QueueLanesProps {
  lanes: QueueLaneData[];
}

export function QueueLanes({ lanes }: QueueLanesProps) {
  return (
    <div className="glass-panel border-t border-white/5 px-4 py-2">
      <div className="flex gap-3">
        {lanes.map((lane) => {
          const total = lane.active + lane.waiting;
          return (
            <div key={lane.name} className="flex flex-1 items-center gap-2 min-w-0">
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                {lane.label}
              </span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                {total > 0 ? (
                  <div className="absolute inset-0 overflow-hidden rounded-full">
                    {Array.from({ length: Math.min(total, 12) }).map((_, i) => (
                      <div
                        key={i}
                        className="absolute top-0.5 h-1 w-1 rounded-full"
                        style={{
                          background: lane.color,
                          boxShadow: `0 0 4px ${lane.color}`,
                          animation: `flow-dot 2.5s linear infinite`,
                          animationDelay: `${(i / Math.min(total, 12)) * -2.5}s`,
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="absolute inset-x-2 top-1/2 border-t border-dashed border-white/10" />
                )}
              </div>
              <span
                className="shrink-0 min-w-[1.25rem] text-right font-mono text-[11px] font-semibold tabular-nums"
                style={{ color: total > 0 ? lane.color : '#52525b' }}
              >
                {total}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
