import { Fragment, useState } from 'react';
import { Settings, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { listMemory, searchMemory, storeMemory, deleteMemory, getModels } from '@/lib/api';
import { useApi } from '@/hooks/use-api';
import { useConfigSection } from '@/hooks/use-config-section';
import { formatDate } from '@/lib/utils';
import { Field } from '@/components/shared/ConfigFields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface MemoryConfig {
  topK: number;
  scoreThreshold: number;
  embeddingModel: string;
  weights: { semantic: number; recency: number; importance: number };
  decayRate: number;
  consolidation: {
    enabled: boolean;
    schedule: string;
    similarityThreshold: number;
    maxClusterSize: number;
  };
}

const TYPE_COLORS: Record<string, string> = {
  episodic: 'bg-purple-500/10 text-purple-600 border-purple-200',
  semantic: 'bg-blue-500/10 text-blue-600 border-blue-200',
  procedural: 'bg-emerald-500/10 text-emerald-600 border-emerald-200',
};

function importanceBadge(importance: number) {
  if (importance >= 8) return { color: 'bg-red-500', label: 'Critical' };
  if (importance >= 6) return { color: 'bg-orange-500', label: 'Important' };
  if (importance >= 4) return { color: 'bg-blue-500', label: 'Useful' };
  return { color: 'bg-gray-400', label: 'Trivial' };
}

export default function Memory() {
  const { data: recentData, loading: recentLoading, refetch: refetchRecent } = useApi(listMemory);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<Record<string, unknown>> | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [storeOpen, setStoreOpen] = useState(false);
  const [storeType, setStoreType] = useState('semantic');
  const [storeSubject, setStoreSubject] = useState('');
  const [storeContent, setStoreContent] = useState('');
  const [storeTags, setStoreTags] = useState('');
  const [storeImportance, setStoreImportance] = useState('5');
  const [storing, setStoring] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const config = useConfigSection<MemoryConfig>('memory');
  const { data: modelsData } = useApi(getModels);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await searchMemory(query.trim());
      setSearchResults(res.results);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSearchError(message);
      toast.error(`Search failed: ${message}`);
    } finally {
      setSearching(false);
    }
  };

  const handleClearSearch = () => {
    setQuery('');
    setSearchResults(null);
    setSearchError(null);
  };

  const handleStore = async () => {
    if (!storeSubject.trim() || !storeContent.trim()) return;
    setStoring(true);
    try {
      const tags = storeTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await storeMemory({
        type: storeType,
        subject: storeSubject.trim(),
        content: storeContent.trim(),
        tags: tags.length ? tags : undefined,
        importance: Number(storeImportance),
      });
      toast.success('Memory stored successfully');
      setStoreOpen(false);
      setStoreType('semantic');
      setStoreSubject('');
      setStoreContent('');
      setStoreTags('');
      setStoreImportance('5');
      if (searchResults !== null && query.trim()) {
        const res = await searchMemory(query.trim());
        setSearchResults(res.results);
      } else {
        refetchRecent();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to store memory: ${message}`);
    } finally {
      setStoring(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this memory entry?')) return;
    try {
      await deleteMemory(id);
      toast.success('Memory deleted successfully');
      if (searchResults !== null) {
        setSearchResults(searchResults.filter((r) => r.id !== id));
      } else {
        refetchRecent();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to delete memory: ${message}`);
    }
  };

  const isSearchMode = searchResults !== null;
  const entries = isSearchMode ? searchResults : (recentData?.results ?? []);
  const showLoading = !isSearchMode && recentLoading;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Memory</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setStoreOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Store Memory
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)} title="Memory settings">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <Input
          placeholder="Search memory..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="flex-1"
        />
        <Button onClick={handleSearch} disabled={searching || !query.trim()}>
          {searching ? 'Searching...' : 'Search'}
        </Button>
        {isSearchMode && (
          <Button variant="outline" onClick={handleClearSearch}>
            Clear
          </Button>
        )}
      </div>

      {searchError && (
        <p className="text-sm text-destructive">Error: {searchError}</p>
      )}

      {showLoading ? (
        <p className="text-sm text-muted-foreground">Loading recent entries...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isSearchMode ? 'No results found.' : 'No memory entries yet.'}
        </p>
      ) : (
        <>
          {!isSearchMode && (
            <p className="text-xs text-muted-foreground">Showing recent entries</p>
          )}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30px]" />
                  <TableHead>Subject</TableHead>
                  <TableHead className="w-[100px]">Type</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="w-[100px]">Importance</TableHead>
                  <TableHead className="w-[150px]">Updated</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const id = entry.id as string;
                  const subject = entry.subject as string | undefined;
                  const type = entry.type as string | undefined;
                  const content = entry.content as string | undefined;
                  const importance = (entry.importance as number) ?? 5;
                  const accessCount = (entry.access_count as number) ?? 0;
                  const source = entry.source as string | undefined;
                  const score = entry.score as number | undefined;
                  const consolidatedInto = entry.consolidated_into as string | undefined;
                  const updatedAt = (entry.updated_at ?? entry.created_at) as string | undefined;
                  const isExpanded = expandedId === id;
                  const imp = importanceBadge(importance);

                  // Tags can be comma-separated string or array
                  const rawTags = entry.tags;
                  const tags: string[] = Array.isArray(rawTags)
                    ? rawTags
                    : typeof rawTags === 'string' && rawTags
                      ? rawTags.split(',').map((t: string) => t.trim()).filter(Boolean)
                      : [];

                  return (
                    <Fragment key={id}>
                      <TableRow
                        className={`cursor-pointer ${consolidatedInto ? 'opacity-50' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : id)}
                      >
                        <TableCell className="px-2">
                          {isExpanded
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-medium text-sm max-w-xs truncate">
                          {subject ?? '-'}
                        </TableCell>
                        <TableCell>
                          {type ? (
                            <Badge variant="outline" className={TYPE_COLORS[type] ?? ''}>
                              {type}
                            </Badge>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {tags.map((tag) => (
                              <Badge key={tag} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-block h-2 w-2 rounded-full ${imp.color}`} />
                            <span className="text-xs text-muted-foreground">{importance}/10</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {updatedAt ? formatDate(updatedAt) : '-'}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${id}-expanded`}>
                          <TableCell />
                          <TableCell colSpan={6}>
                            <div className="space-y-2 py-2">
                              <div className="text-sm whitespace-pre-wrap text-muted-foreground">
                                {content ?? 'No content'}
                              </div>
                              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                {source && <span>Source: <strong>{source}</strong></span>}
                                {accessCount > 0 && <span>Accessed: <strong>{accessCount}x</strong></span>}
                                {score !== undefined && <span>Score: <strong>{score.toFixed(3)}</strong></span>}
                                {consolidatedInto && <span>Consolidated into: <code className="text-xs">{consolidatedInto}</code></span>}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Store dialog */}
      <Dialog open={storeOpen} onOpenChange={setStoreOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Store New Memory</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="memory-type">Type</Label>
                <Select value={storeType} onValueChange={setStoreType}>
                  <SelectTrigger id="memory-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="episodic">Episodic</SelectItem>
                    <SelectItem value="semantic">Semantic</SelectItem>
                    <SelectItem value="procedural">Procedural</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {storeType === 'episodic' && 'Events, interactions, what happened'}
                  {storeType === 'semantic' && 'Facts, knowledge, personal info'}
                  {storeType === 'procedural' && 'Patterns, workflows, routines'}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="memory-importance">Importance ({storeImportance}/10)</Label>
                <Input
                  id="memory-importance"
                  type="range"
                  min="1"
                  max="10"
                  value={storeImportance}
                  onChange={(e) => setStoreImportance(e.target.value)}
                  className="cursor-pointer"
                />
                <p className="text-xs text-muted-foreground">
                  {Number(storeImportance) <= 3 && 'Trivial — minor details'}
                  {Number(storeImportance) >= 4 && Number(storeImportance) <= 6 && 'Useful — project details, preferences'}
                  {Number(storeImportance) >= 7 && Number(storeImportance) <= 9 && 'Important — key decisions, core context'}
                  {Number(storeImportance) === 10 && 'Critical — never forget'}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="memory-subject">Subject *</Label>
              <Input
                id="memory-subject"
                placeholder="1-line summary of the memory"
                value={storeSubject}
                onChange={(e) => setStoreSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="memory-content">Content *</Label>
              <Textarea
                id="memory-content"
                placeholder="Full memory content..."
                value={storeContent}
                onChange={(e) => setStoreContent(e.target.value)}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="memory-tags">Tags</Label>
              <Input
                id="memory-tags"
                placeholder="project:taskflow, person:alice"
                value={storeTags}
                onChange={(e) => setStoreTags(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Comma-separated, namespace:value format</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStoreOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleStore} disabled={storing || !storeSubject.trim() || !storeContent.trim()}>
              {storing ? 'Storing...' : 'Store'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Memory Settings
              {config.dirty && <Badge variant="secondary" className="ml-2">Unsaved</Badge>}
            </DialogTitle>
          </DialogHeader>
          {config.loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : config.section ? (
            <div className="space-y-6">
              {/* General */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Embedding Model" description="Model used for memory embeddings">
                  <Select
                    value={config.section.embeddingModel || 'auto'}
                    onValueChange={(v) => config.update((c) => { c.embeddingModel = v; })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      {(modelsData?.embeddingModels ?? [])
                        .filter((m) => m.enabled)
                        .map((m) => (
                          <SelectItem key={m.id as string} value={m.id as string}>
                            {(m.name as string) || (m.id as string)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Top K" description="Number of results to return">
                  <Input
                    type="number"
                    value={String(config.section.topK)}
                    onChange={(e) => config.update((c) => { c.topK = Number(e.target.value); })}
                  />
                </Field>
                <Field label="Score Threshold" description="Minimum similarity score (0-1)">
                  <Input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={String(config.section.scoreThreshold)}
                    onChange={(e) => config.update((c) => { c.scoreThreshold = Number(e.target.value); })}
                  />
                </Field>
                <Field label="Decay Rate" description="Temporal decay factor (higher = faster decay)">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={String(config.section.decayRate)}
                    onChange={(e) => config.update((c) => { c.decayRate = Number(e.target.value); })}
                  />
                </Field>
              </div>

              {/* Scoring Weights */}
              <div>
                <h3 className="text-sm font-medium mb-2">Scoring Weights</h3>
                <p className="text-xs text-muted-foreground mb-3">Controls how memories are ranked. Should sum to 1.0.</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Semantic" description="">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={String(config.section.weights?.semantic ?? 0.6)}
                      onChange={(e) => config.update((c) => { c.weights = { ...c.weights, semantic: Number(e.target.value) }; })}
                    />
                  </Field>
                  <Field label="Recency" description="">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={String(config.section.weights?.recency ?? 0.2)}
                      onChange={(e) => config.update((c) => { c.weights = { ...c.weights, recency: Number(e.target.value) }; })}
                    />
                  </Field>
                  <Field label="Importance" description="">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={String(config.section.weights?.importance ?? 0.2)}
                      onChange={(e) => config.update((c) => { c.weights = { ...c.weights, importance: Number(e.target.value) }; })}
                    />
                  </Field>
                </div>
              </div>

              {/* Consolidation */}
              <div>
                <h3 className="text-sm font-medium mb-2">Consolidation</h3>
                <p className="text-xs text-muted-foreground mb-3">Merges similar memories into comprehensive summaries.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Enabled" description="Run consolidation on schedule">
                    <Select
                      value={String(config.section.consolidation?.enabled ?? true)}
                      onValueChange={(v) => config.update((c) => { c.consolidation = { ...c.consolidation, enabled: v === 'true' }; })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Enabled</SelectItem>
                        <SelectItem value="false">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Schedule" description="Cron pattern">
                    <Input
                      value={config.section.consolidation?.schedule ?? '0 3 * * *'}
                      onChange={(e) => config.update((c) => { c.consolidation = { ...c.consolidation, schedule: e.target.value }; })}
                    />
                  </Field>
                  <Field label="Similarity Threshold" description="Min similarity to cluster (0-1)">
                    <Input
                      type="number"
                      step="0.05"
                      min="0.5"
                      max="1"
                      value={String(config.section.consolidation?.similarityThreshold ?? 0.85)}
                      onChange={(e) => config.update((c) => { c.consolidation = { ...c.consolidation, similarityThreshold: Number(e.target.value) }; })}
                    />
                  </Field>
                  <Field label="Max Cluster Size" description="Max memories per consolidation group">
                    <Input
                      type="number"
                      min="2"
                      max="10"
                      value={String(config.section.consolidation?.maxClusterSize ?? 5)}
                      onChange={(e) => config.update((c) => { c.consolidation = { ...c.consolidation, maxClusterSize: Number(e.target.value) }; })}
                    />
                  </Field>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => { config.reset(); setSettingsOpen(false); }}>
              Cancel
            </Button>
            <Button onClick={async () => { await config.save(); setSettingsOpen(false); }} disabled={config.saving || !config.dirty}>
              {config.saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
