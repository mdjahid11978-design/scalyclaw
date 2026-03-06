export type AvatarState = 'idle' | 'thinking' | 'working' | 'delegating' | 'sleeping';

// 16x16 front-facing pixel dragon
const FRAME = [
  '................',
  '......a..a......',
  '.....aea.aea....',
  '....eeeeeeee....',
  '...eeeeeeeeee...',
  '...ewpeeeepwe...',
  '...eeeeeeeeee...',
  '....eellllee....',
  '.....elllle.....',
  '...deelllleedd..',
  '..ddeelllleedd..',
  '.dddeelllleeddd.',
  '..ddeelllleedd..',
  '....eeeeeeee....',
  '...eee....eee...',
  '...ee......ee...',
];

const COLORS: Record<string, string> = {
  e: '#10b981',
  d: '#059669',
  l: '#34d399',
  w: '#ffffff',
  p: '#111827',
  a: '#f59e0b',
  g: '#6ee7b7',
};

const PX = 12; // pixels per cell → 192px total

interface OrbitalJob {
  id: string;
  color: string;
  index: number;
  total: number;
}

interface PixelAvatarProps {
  state: AvatarState;
  orbitalJobs?: OrbitalJob[];
}

export function PixelAvatar({ state, orbitalJobs = [] }: PixelAvatarProps) {
  const stateClass =
    state === 'idle'
      ? 'animate-breathe'
      : state === 'thinking'
        ? 'animate-vibrate avatar-glow'
        : state === 'working'
          ? 'animate-breathe-fast avatar-glow'
          : state === 'delegating'
            ? 'avatar-glow-purple'
            : state === 'sleeping'
              ? 'avatar-sleeping'
              : '';

  return (
    <div className="relative flex items-center justify-center">
      {/* Ambient glow behind avatar */}
      <div
        className={`absolute rounded-full blur-3xl transition-opacity duration-1000 ${
          state === 'sleeping' ? 'opacity-10' : 'opacity-20'
        }`}
        style={{ width: 260, height: 260, background: 'radial-gradient(circle, #10b981 0%, transparent 70%)' }}
      />

      {/* Orbital ring */}
      <div className="absolute" style={{ width: 280, height: 280 }}>
        {orbitalJobs.map((job) => (
          <div
            key={job.id}
            className="absolute left-1/2 top-1/2"
            style={{
              animation: `orbit ${6 + job.total}s linear infinite`,
              animationDelay: `${(job.index / Math.max(job.total, 1)) * -(6 + job.total)}s`,
            }}
          >
            <div
              className="h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                background: job.color,
                boxShadow: `0 0 8px ${job.color}`,
                '--orbit-radius': '130px',
              } as React.CSSProperties}
            />
          </div>
        ))}
      </div>

      {/* SVG Pixel Dragon */}
      <svg
        width={16 * PX}
        height={16 * PX}
        viewBox={`0 0 ${16 * PX} ${16 * PX}`}
        className={`relative z-10 transition-all duration-500 ${stateClass}`}
        style={state === 'sleeping' ? { transform: 'rotate(-15deg) scale(0.9)', filter: 'brightness(0.5)' } : undefined}
      >
        {FRAME.map((row, y) =>
          [...row].map((ch, x) => {
            if (ch === '.') return null;
            let color = COLORS[ch] ?? 'transparent';
            // Thinking state: glow eyes
            if (state === 'thinking' && (ch === 'w' || ch === 'p')) {
              color = COLORS.g;
            }
            // Delegating state: purple tint on wings
            if (state === 'delegating' && ch === 'd') {
              color = '#8b5cf6';
            }
            return (
              <rect
                key={`${x}-${y}`}
                x={x * PX}
                y={y * PX}
                width={PX}
                height={PX}
                fill={color}
                rx={1}
              />
            );
          }),
        )}
      </svg>

      {/* Sleeping ZZZ */}
      {state === 'sleeping' && (
        <div className="absolute -right-2 -top-4 z-20 flex flex-col items-start gap-1">
          {['z', 'z', 'Z'].map((ch, i) => (
            <span
              key={i}
              className="font-mono font-bold text-emerald-400/60"
              style={{
                fontSize: 10 + i * 4,
                animation: `float-up 2.5s ease-in-out infinite`,
                animationDelay: `${i * 0.5}s`,
              }}
            >
              {ch}
            </span>
          ))}
        </div>
      )}

      {/* Thinking thought bubbles */}
      {state === 'thinking' && (
        <div className="absolute -right-6 -top-6 z-20">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute rounded-full bg-emerald-400/40"
              style={{
                width: 6 + i * 4,
                height: 6 + i * 4,
                right: i * 10,
                top: (2 - i) * 10,
                animation: `float-up 2s ease-in-out infinite`,
                animationDelay: `${i * 0.3}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Working sparkles */}
      {state === 'working' && (
        <div className="absolute inset-0 z-20">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="absolute h-1 w-1 rounded-full bg-emerald-300"
              style={{
                left: `${30 + Math.cos((i * Math.PI) / 2) * 40}%`,
                top: `${30 + Math.sin((i * Math.PI) / 2) * 40}%`,
                animation: `sparkle 1.2s ease-in-out infinite`,
                animationDelay: `${i * 0.3}s`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
