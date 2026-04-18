import { useState } from 'react';
import { useConfigSection } from '@/hooks/use-config-section';
import { useApi } from '@/hooks/use-api';
import {
  getModels, triggerEngagement, getEngagementStatus,
  getEngagementHistory, muteEngagement, unmuteEngagement,
  type EngagementEvent,
} from '@/lib/api';
import { Field } from '@/components/shared/ConfigFields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

interface EngagementConfig {
  enabled: boolean;
  model: string;
  monitorCronPattern: string;

  signals: {
    idleThresholdMinutes: number;
    idleMaxDays: number;
    timeSensitiveLeadMinutes: number;
    returnFromAbsenceHours: number;
  };

  engagement: {
    baseThreshold: number;
    responseWindowMinutes: number;
    adaptiveRange: { min: number; max: number };
  };

  rateLimits: {
    cooldownSeconds: {
      urgent: number;
      deliverable: number;
      insight: number;
      check_in: number;
    };
    maxPerDay: number;
    maxUrgentPerDay: number;
  };

  quietHours: {
    enabled: boolean;
    start: number;
    end: number;
    timezone: string;
    urgentOverride: boolean;
  };

  triggerWeights: {
    urgent: number;
    deliverable: number;
    insight: number;
    check_in: number;
  };
}

type EngagementTab = 'general' | 'signals' | 'rate-limits' | 'quiet-hours' | 'weights' | 'status' | 'history';

function ModelSelect({
  value,
  onChange,
  disabled,
  models,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  models: Array<Record<string, unknown>>;
}) {
  return (
    <Select
      value={value || '_default'}
      onValueChange={(v) => onChange(v === '_default' ? '' : v)}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="_default">Auto (weighted selection)</SelectItem>
        {models.filter((m) => m.enabled).map((m) => (
          <SelectItem key={String(m.id)} value={String(m.id)}>
            {String(m.name || m.id)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const variant = outcome === 'correct_detection' ? 'default'
    : outcome === 'false_alarm' ? 'destructive'
    : 'secondary';
  const label = outcome === 'correct_detection' ? 'Engaged'
    : outcome === 'false_alarm' ? 'Dismissed'
    : 'Pending';
  return <Badge variant={variant}>{label}</Badge>;
}

export default function Engagement() {
  const config = useConfigSection<EngagementConfig>('proactive');
  const modelsApi = useApi(getModels);
  const statusApi = useApi(getEngagementStatus);
  const historyApi = useApi(getEngagementHistory);
  const [tab, setTab] = useState<EngagementTab>('general');
  const [triggering, setTriggering] = useState(false);

  if (config.loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading engagement config...
      </div>
    );
  }

  if (!config.section) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Engagement config not available.
      </div>
    );
  }

  const engagement = config.section;
  const models = modelsApi.data?.models ?? [];
  const status = statusApi.data;
  const history = historyApi.data ?? [];

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      const result = await triggerEngagement();
      if (result.triggered > 0) {
        toast.success('Engagement message sent');
      } else {
        toast.info(result.message ?? 'No triggers found');
      }
      statusApi.refetch();
      historyApi.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Trigger failed');
    } finally {
      setTriggering(false);
    }
  };

  const handleMute = async () => {
    try {
      await muteEngagement(60);
      toast.success('Muted for 1 hour');
      statusApi.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Mute failed');
    }
  };

  const handleUnmute = async () => {
    try {
      await unmuteEngagement();
      toast.success('Unmuted');
      statusApi.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unmute failed');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Engagement</h1>
          {config.dirty && <Badge variant="secondary">Unsaved</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {status?.profile.mutedUntil ? (
            <Button variant="outline" size="sm" onClick={handleUnmute}>Unmute</Button>
          ) : (
            <Button variant="outline" size="sm" onClick={handleMute} disabled={!engagement.enabled}>Mute 1h</Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleTrigger}
            disabled={triggering || !engagement.enabled}
          >
            {triggering ? 'Triggering...' : 'Trigger Now'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => config.reset()}
            disabled={!config.dirty}
          >
            Discard
          </Button>
          <Button
            size="sm"
            onClick={() => config.save()}
            disabled={config.saving || !config.dirty}
          >
            {config.saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as EngagementTab)}>
        <TabsList>
          <TabsTrigger value="general">
            General
            {engagement.enabled && (
              <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="signals">Signals</TabsTrigger>
          <TabsTrigger value="rate-limits">Rate Limits</TabsTrigger>
          <TabsTrigger value="quiet-hours">
            Quiet Hours
            {engagement.quietHours.enabled && (
              <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="weights">Weights</TabsTrigger>
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* General */}
        <TabsContent value="general" className="mt-4">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Switch
                checked={engagement.enabled}
                onCheckedChange={(v) => config.update((c) => { c.enabled = v; })}
              />
              <Label className="text-sm font-medium">
                {engagement.enabled ? 'Enabled' : 'Disabled'}
              </Label>
            </div>

            {engagement.enabled && (
              <div className="space-y-4">
                <Field label="Model" description="Model for evaluation and generation. Leave empty for auto-selection.">
                  <ModelSelect
                    value={engagement.model}
                    onChange={(v) => config.update((c) => { c.model = v; })}
                    models={models}
                  />
                </Field>

                <Field label="Monitor Cron Pattern" description="How often to run the signal scan (no LLM calls).">
                  <Input
                    value={engagement.monitorCronPattern}
                    onChange={(e) => config.update((c) => { c.monitorCronPattern = e.target.value; })}
                    placeholder="*/5 * * * *"
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Base Threshold" description="Minimum aggregate signal strength to trigger LLM evaluation (0-1).">
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={String(engagement.engagement.baseThreshold)}
                      onChange={(e) => config.update((c) => { c.engagement.baseThreshold = Number(e.target.value); })}
                    />
                  </Field>
                  <Field label="Response Window (min)" description="Time to wait for user response before marking as dismissed.">
                    <Input
                      type="number"
                      min="1"
                      value={String(engagement.engagement.responseWindowMinutes)}
                      onChange={(e) => config.update((c) => { c.engagement.responseWindowMinutes = Number(e.target.value); })}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Adaptive Range Min" description="Lower bound for adaptive threshold (more proactive).">
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={String(engagement.engagement.adaptiveRange.min)}
                      onChange={(e) => config.update((c) => { c.engagement.adaptiveRange.min = Number(e.target.value); })}
                    />
                  </Field>
                  <Field label="Adaptive Range Max" description="Upper bound for adaptive threshold (less proactive).">
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={String(engagement.engagement.adaptiveRange.max)}
                      onChange={(e) => config.update((c) => { c.engagement.adaptiveRange.max = Number(e.target.value); })}
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Signals */}
        <TabsContent value="signals" className="mt-4">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Configure signal detection thresholds. Signals are detected without LLM calls.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Idle Threshold (min)" description="Minutes of inactivity before idle signal fires.">
                <Input
                  type="number"
                  min="1"
                  value={String(engagement.signals.idleThresholdMinutes)}
                  onChange={(e) => config.update((c) => { c.signals.idleThresholdMinutes = Number(e.target.value); })}
                />
              </Field>
              <Field label="Idle Max Days" description="Don't re-engage channels idle beyond this.">
                <Input
                  type="number"
                  min="1"
                  value={String(engagement.signals.idleMaxDays)}
                  onChange={(e) => config.update((c) => { c.signals.idleMaxDays = Number(e.target.value); })}
                />
              </Field>
              <Field label="Time-Sensitive Lead (min)" description="Minutes before a deadline to trigger time-sensitive signal.">
                <Input
                  type="number"
                  min="1"
                  value={String(engagement.signals.timeSensitiveLeadMinutes)}
                  onChange={(e) => config.update((c) => { c.signals.timeSensitiveLeadMinutes = Number(e.target.value); })}
                />
              </Field>
              <Field label="Return From Absence (hours)" description="Hours of absence before return-from-absence signal fires.">
                <Input
                  type="number"
                  min="1"
                  value={String(engagement.signals.returnFromAbsenceHours)}
                  onChange={(e) => config.update((c) => { c.signals.returnFromAbsenceHours = Number(e.target.value); })}
                />
              </Field>
            </div>
          </div>
        </TabsContent>

        {/* Rate Limits */}
        <TabsContent value="rate-limits" className="mt-4">
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Max Per Day" description="Global daily cap for non-urgent messages.">
                <Input
                  type="number"
                  min="1"
                  value={String(engagement.rateLimits.maxPerDay)}
                  onChange={(e) => config.update((c) => { c.rateLimits.maxPerDay = Number(e.target.value); })}
                />
              </Field>
              <Field label="Max Urgent Per Day" description="Separate daily cap for urgent messages.">
                <Input
                  type="number"
                  min="1"
                  value={String(engagement.rateLimits.maxUrgentPerDay)}
                  onChange={(e) => config.update((c) => { c.rateLimits.maxUrgentPerDay = Number(e.target.value); })}
                />
              </Field>
            </div>

            <p className="text-sm font-medium">Cooldown per Trigger Type (seconds)</p>
            <div className="grid gap-4 sm:grid-cols-3">
              {(['urgent', 'deliverable', 'insight', 'check_in'] as const).map((t) => (
                <Field key={t} label={t.replace('_', ' ')} description={`Cooldown after sending a ${t.replace('_', ' ')} message.`}>
                  <Input
                    type="number"
                    min="0"
                    value={String(engagement.rateLimits.cooldownSeconds[t])}
                    onChange={(e) => config.update((c) => { c.rateLimits.cooldownSeconds[t] = Number(e.target.value); })}
                  />
                </Field>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Quiet Hours */}
        <TabsContent value="quiet-hours" className="mt-4">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Switch
                checked={engagement.quietHours.enabled}
                onCheckedChange={(v) => config.update((c) => { c.quietHours.enabled = v; })}
              />
              <Label className="text-sm font-medium">
                {engagement.quietHours.enabled ? 'Enabled' : 'Disabled'}
              </Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Suppress engagement messages during specific hours.
            </p>

            {engagement.quietHours.enabled && (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Start Hour (0-23)" description="Quiet period start.">
                    <Input
                      type="number"
                      min="0"
                      max="23"
                      value={String(engagement.quietHours.start)}
                      onChange={(e) => config.update((c) => { c.quietHours.start = Number(e.target.value); })}
                    />
                  </Field>
                  <Field label="End Hour (0-23)" description="Quiet period end.">
                    <Input
                      type="number"
                      min="0"
                      max="23"
                      value={String(engagement.quietHours.end)}
                      onChange={(e) => config.update((c) => { c.quietHours.end = Number(e.target.value); })}
                    />
                  </Field>
                  <Field label="Timezone" description="IANA timezone (e.g. America/New_York).">
                    <Input
                      value={engagement.quietHours.timezone}
                      onChange={(e) => config.update((c) => { c.quietHours.timezone = e.target.value; })}
                      placeholder="UTC"
                    />
                  </Field>
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    checked={engagement.quietHours.urgentOverride}
                    onCheckedChange={(v) => config.update((c) => { c.quietHours.urgentOverride = v; })}
                  />
                  <Label className="text-sm font-medium">
                    Allow urgent messages during quiet hours
                  </Label>
                </div>
              </>
            )}
          </div>
        </TabsContent>

        {/* Trigger Weights */}
        <TabsContent value="weights" className="mt-4">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Weight each trigger type when computing aggregate signal strength. Higher weight = more likely to trigger.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {(['urgent', 'deliverable', 'insight', 'check_in'] as const).map((t) => (
                <Field key={t} label={t.replace('_', ' ')} description={`Weight for ${t.replace('_', ' ')} triggers (0-1).`}>
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={String(engagement.triggerWeights[t])}
                    onChange={(e) => config.update((c) => { c.triggerWeights[t] = Number(e.target.value); })}
                  />
                </Field>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Status */}
        <TabsContent value="status" className="mt-4">
          {status ? (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Engagement Score</p>
                  <p className="text-2xl font-bold">{(status.profile.engagementScore * 100).toFixed(0)}%</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Today</p>
                  <p className="text-2xl font-bold">{status.dailyCount} / {status.maxPerDay}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Total Sent</p>
                  <p className="text-2xl font-bold">{status.profile.totalSent}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Engaged / Dismissed</p>
                  <p className="text-2xl font-bold">{status.profile.totalEngaged} / {status.profile.totalDismissed}</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Cooldowns</p>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(status.cooldowns).map(([type, active]) => (
                    <Badge key={type} variant={active ? 'destructive' : 'outline'}>
                      {type.replace('_', ' ')}: {active ? 'active' : 'clear'}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-1 text-sm text-muted-foreground">
                <p>Style: {status.profile.stylePreference}</p>
                <p>Last proactive: {status.profile.lastProactiveAt ?? 'never'}</p>
                <p>Last user message: {status.profile.lastUserMsgAt ?? 'never'}</p>
                {status.profile.mutedUntil && <p>Muted until: {status.profile.mutedUntil}</p>}
              </div>

              <Button variant="outline" size="sm" onClick={() => statusApi.refetch()}>
                Refresh
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading status...</p>
          )}
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="mt-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Recent engagement events</p>
              <Button variant="outline" size="sm" onClick={() => historyApi.refetch()}>
                Refresh
              </Button>
            </div>

            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No engagement events yet.</p>
            ) : (
              <div className="space-y-2">
                {history.map((event: EngagementEvent) => (
                  <div key={event.id} className="rounded-lg border p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{event.triggerType.replace('_', ' ')}</Badge>
                        <OutcomeBadge outcome={event.outcome} />
                        {event.sentiment && <Badge variant="secondary">{event.sentiment}</Badge>}
                      </div>
                      <span className="text-xs text-muted-foreground">{event.createdAt}</span>
                    </div>
                    <p className="text-sm">{event.message}</p>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>Channel: {event.channel}</span>
                      {event.responseTimeS !== null && <span>Response: {event.responseTimeS}s</span>}
                      <span>Signals: {event.signalTypes.join(', ')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
