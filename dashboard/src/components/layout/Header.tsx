import { useNavigate, useLocation } from 'react-router';
import { Menu, Sun, Moon, MessageSquare, LayoutDashboard, Flame } from 'lucide-react';
import { StatusDot } from '@/components/shared/StatusDot';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

interface HeaderProps {
  title: string;
  wsStatus: 'connected' | 'connecting' | 'disconnected';
  onMenuClick: () => void;
  onChatClick: () => void;
  chatUnread: number;
}

export function Header({ title, wsStatus, onMenuClick, onChatClick, chatUnread }: HeaderProps) {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isSanctum = location.pathname === '/activity';

  return (
    <header className="flex h-14 items-center gap-3 border-b px-4 backdrop-blur-md bg-background/80">
      {!isSanctum && (
        <button
          onClick={onMenuClick}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}
      <h1 className="flex-1 text-lg font-semibold">{title}</h1>
      <div className="flex items-center gap-3">
        {/* Mode toggle */}
        <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5">
          <button
            onClick={() => navigate('/')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
              !isSanctum
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutDashboard className="h-3 w-3" />
            <span className="hidden sm:inline">Dashboard</span>
          </button>
          <button
            onClick={() => navigate('/activity')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
              isSanctum
                ? 'bg-emerald-500/15 text-emerald-400 shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Flame className="h-3 w-3" />
            <span className="hidden sm:inline">Sanctum</span>
          </button>
        </div>

        <button
          onClick={onChatClick}
          className="relative rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          title="Open chat"
        >
          <MessageSquare className="h-4 w-4" />
          {chatUnread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
              {chatUnread > 9 ? '9+' : chatUnread}
            </span>
          )}
        </button>
        <button
          onClick={toggle}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <StatusDot status={wsStatus} />
          <span className="hidden sm:inline">
            {wsStatus === 'connected' ? 'Connected' : wsStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
          </span>
        </div>
      </div>
    </header>
  );
}
