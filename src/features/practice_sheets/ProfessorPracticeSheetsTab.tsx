/**
 * ProfessorPracticeSheetsTab — management UI for a lecture's practice sheets.
 * Rendered inside the LectureEdit page as a collapsible section.
 *
 * States:
 *   list    — shows all sheets, allows create / generate / toggle status / delete
 *   editing — opens PracticeSheetEditor for a manual sheet
 *   taking  — opens PracticeSheetTaker in preview mode
 */
import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, Plus, Trash2, Eye, Loader2, BookOpen, Pencil,
  CheckCircle2, Clock, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  listPracticeSheets,
  generateAutoSheet,
  createManualSheet,
  deletePracticeSheet,
  updatePracticeSheet,
  getPracticeSheet,
  type PracticeSheet,
} from '@/services/practiceSheetsService';
import { PracticeSheetEditor } from './PracticeSheetEditor';
import { PracticeSheetTaker } from './PracticeSheetTaker';

interface Props {
  lectureId: string;
}

type View =
  | { kind: 'list' }
  | { kind: 'editing'; sheet: PracticeSheet }
  | { kind: 'taking'; sheet: PracticeSheet };

export function ProfessorPracticeSheetsTab({ lectureId }: Props) {
  const { toast } = useToast();

  const [sheets, setSheets] = useState<PracticeSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [creatingTitle, setCreatingTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [view, setView] = useState<View>({ kind: 'list' });

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setSheets(await listPracticeSheets(lectureId));
    } catch (err) {
      console.error(err);
      toast({ title: 'Failed to load practice sheets', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [lectureId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const sheet = await generateAutoSheet(lectureId);
      toast({ title: sheet.kind === 'auto' ? 'Auto sheet generated' : 'Auto sheet regenerated' });
      await refresh();
    } catch (err) {
      toast({
        title: 'Generation failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (!creatingTitle.trim()) return;
    setCreating(true);
    try {
      const sheet = await createManualSheet(lectureId, creatingTitle.trim());
      setCreatingTitle('');
      setShowCreate(false);
      await refresh();
      const full = await getPracticeSheet(sheet.id);
      setView({ kind: 'editing', sheet: full });
    } catch (err) {
      toast({ title: 'Failed to create sheet', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (sheet: PracticeSheet) => {
    if (!window.confirm(`Delete "${sheet.title}"? This cannot be undone.`)) return;
    try {
      await deletePracticeSheet(sheet.id);
      toast({ title: 'Sheet deleted' });
      await refresh();
    } catch (err) {
      toast({ title: 'Failed to delete', variant: 'destructive' });
    }
  };

  const handleToggleStatus = async (sheet: PracticeSheet) => {
    const next = sheet.status === 'published' ? 'draft' : 'published';
    try {
      await updatePracticeSheet(sheet.id, { status: next });
      toast({ title: next === 'published' ? 'Sheet published' : 'Sheet unpublished' });
      await refresh();
    } catch (err) {
      toast({ title: 'Failed to update status', variant: 'destructive' });
    }
  };

  const handleOpenEditor = async (sheet: PracticeSheet) => {
    try {
      const full = await getPracticeSheet(sheet.id);
      setView({ kind: 'editing', sheet: full });
    } catch (err) {
      toast({ title: 'Failed to load sheet', variant: 'destructive' });
    }
  };

  const handleOpenPreview = async (sheet: PracticeSheet) => {
    try {
      const full = await getPracticeSheet(sheet.id);
      setView({ kind: 'taking', sheet: full });
    } catch (err) {
      toast({ title: 'Failed to load sheet', variant: 'destructive' });
    }
  };

  if (view.kind === 'editing') {
    return (
      <PracticeSheetEditor
        sheet={view.sheet}
        onBack={() => { setView({ kind: 'list' }); void refresh(); }}
        onPreview={() => setView({ kind: 'taking', sheet: view.sheet })}
        onSheetChange={(s) => setView({ kind: 'editing', sheet: s })}
      />
    );
  }

  if (view.kind === 'taking') {
    return (
      <PracticeSheetTaker
        sheet={view.sheet}
        isPreview
        onBack={() => setView({ kind: 'list' })}
      />
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────

  const autoSheet = sheets.find(s => s.kind === 'auto');
  const manualSheets = sheets.filter(s => s.kind === 'manual');

  return (
    <div className="space-y-6">
      {/* Auto sheet card */}
      <div className="bg-muted/40 rounded-2xl border border-border p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">Auto-generated sheet</p>
              <p className="text-xs text-muted-foreground">
                Built from this lecture's quiz questions. Regenerate any time.
              </p>
            </div>
          </div>
          {autoSheet && (
            <StatusBadge status={autoSheet.status} />
          )}
        </div>

        {autoSheet ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {autoSheet.question_count ?? 0} question{(autoSheet.question_count ?? 0) !== 1 ? 's' : ''}
              {' '}· Last updated {autoSheet.updated_at ? new Date(autoSheet.updated_at).toLocaleDateString() : '—'}
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerate}
                disabled={generating}
                className="gap-1.5"
              >
                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Regenerate
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleOpenPreview(autoSheet)}
                className="gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" /> Preview as student
              </Button>
              <Button
                size="sm"
                variant={autoSheet.status === 'published' ? 'secondary' : 'default'}
                onClick={() => handleToggleStatus(autoSheet)}
                className="gap-1.5"
              >
                {autoSheet.status === 'published' ? (
                  <><Clock className="w-3.5 h-3.5" /> Unpublish</>
                ) : (
                  <><CheckCircle2 className="w-3.5 h-3.5" /> Publish</>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={generating}
            className="gap-1.5"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {generating ? 'Generating…' : 'Generate from quiz questions'}
          </Button>
        )}
      </div>

      {/* Manual sheets */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-foreground">
            Manual sheets
            {manualSheets.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({manualSheets.length})
              </span>
            )}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowCreate(!showCreate)}
            className="gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> New sheet
          </Button>
        </div>

        {showCreate && (
          <div className="bg-card rounded-xl border border-border p-4 mb-3 flex gap-2">
            <Input
              value={creatingTitle}
              onChange={e => setCreatingTitle(e.target.value)}
              placeholder="Sheet title…"
              className="flex-1"
              onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
              autoFocus
            />
            <Button size="sm" onClick={handleCreate} disabled={creating || !creatingTitle.trim()}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Create'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowCreate(false); setCreatingTitle(''); }}>
              Cancel
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : manualSheets.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No manual sheets yet. Create one to author your own questions.
          </p>
        ) : (
          <div className="space-y-2">
            {manualSheets.map(sheet => (
              <div
                key={sheet.id}
                className="bg-card rounded-xl border border-border p-4 flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground truncate">{sheet.title}</p>
                    <StatusBadge status={sheet.status} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {sheet.question_count ?? 0} question{(sheet.question_count ?? 0) !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    title="Edit"
                    onClick={() => handleOpenEditor(sheet)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    title="Preview as student"
                    onClick={() => handleOpenPreview(sheet)}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`h-8 w-8 ${sheet.status === 'published' ? 'text-muted-foreground' : 'text-green-600 dark:text-green-400'}`}
                    title={sheet.status === 'published' ? 'Unpublish' : 'Publish'}
                    onClick={() => handleToggleStatus(sheet)}
                  >
                    {sheet.status === 'published'
                      ? <Clock className="w-3.5 h-3.5" />
                      : <CheckCircle2 className="w-3.5 h-3.5" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    title="Delete"
                    onClick={() => handleDelete(sheet)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
        status === 'published'
          ? 'bg-green-500/15 text-green-700 dark:text-green-400'
          : 'bg-muted text-muted-foreground'
      }`}
    >
      {status === 'published' ? 'Published' : 'Draft'}
    </span>
  );
}
