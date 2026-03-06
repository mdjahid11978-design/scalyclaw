import { useState, useEffect } from 'react';

interface PulseRingProps {
  trigger: number;
}

export function PulseRing({ trigger }: PulseRingProps) {
  const [rings, setRings] = useState<number[]>([]);

  useEffect(() => {
    if (trigger === 0) return;
    const id = Date.now();
    setRings((prev) => [...prev.slice(-6), id]);
    const timer = setTimeout(() => {
      setRings((prev) => prev.filter((r) => r !== id));
    }, 1600);
    return () => clearTimeout(timer);
  }, [trigger]);

  return (
    <div className="pointer-events-none absolute inset-0">
      {rings.map((id, i) => (
        <div key={id} className="absolute left-1/2 top-1/2" style={{ animationDelay: `${i * 80}ms` }}>
          <div className="activity-pulse-ring" />
        </div>
      ))}
    </div>
  );
}
