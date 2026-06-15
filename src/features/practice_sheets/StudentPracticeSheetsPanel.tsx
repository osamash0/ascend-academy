/**
 * StudentPracticeSheetsPanel — shown on the LectureView page.
 * Lists published practice sheets and lets the student open / take one.
 */
import { useCallback, useEffect, useState } from 'react';
import { BookOpen, ChevronRight, Loader2, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listPracticeSheets, getPracticeSheet, type PracticeSheet } from '@/services/practiceSheetsService';
import { PracticeSheetTaker } from './PracticeSheetTaker';
import { useToast } from '@/hooks/use-toast';

interface Props {
  lectureId: string;
}

export function StudentPracticeSheetsPanel({ lectureId }: Props) {
  const [sheets, setSheets] = useState<PracticeSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<PracticeSheet | null>(null);
  const [loadingSheet, setLoadingSheet] = useState<string | null>(null);
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const all = await listPracticeSheets(lectureId);
      setSheets(all);
    } catch (err) {
      console.error('Failed to load practice sheets', err);
      toast({
        title: 'Error loading practice sheets',
        description: 'Please try again later.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [lectureId, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openSheet = async (sheet: PracticeSheet) => {
    setLoadingSheet(sheet.id);
    try {
      const full = await getPracticeSheet(sheet.id);
      setActive(full);
    } catch (err) {
      console.error('Failed to open practice sheet', err);
      toast({
        title: 'Error opening practice sheet',
        description: 'Please try again later.',
        variant: 'destructive',
      });
    } finally {
      setLoadingSheet(null);
    }
  };


  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading practice sheets…
      </div>
    );
  }

  if (sheets.length === 0) {
    return null;
  }

  if (active) {
    return (
      <PracticeSheetTaker
        sheet={active}
        isPreview={false}
        onBack={() => setActive(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Practice Sheets</h3>
        <span className="text-xs text-muted-foreground">({sheets.length})</span>
      </div>

      <div className="space-y-2">
        {sheets.map(sheet => (
          <div
            key={sheet.id}
            className="bg-card rounded-xl border border-border p-4 flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{sheet.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {sheet.kind === 'auto' ? 'Auto-generated' : 'Professor-authored'}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openSheet(sheet)}
              disabled={loadingSheet === sheet.id}
              className="gap-1.5 flex-shrink-0"
            >
              {loadingSheet === sheet.id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>Start <ChevronRight className="w-3.5 h-3.5" /></>
              )}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
