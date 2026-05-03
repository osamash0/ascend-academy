/**
 * PracticeSheetEditor — let professors build a manual practice sheet.
 * Supports adding / editing / deleting / reordering questions of all three
 * types (multiple_choice, short_answer, free_form).
 */
import { useState } from 'react';
import {
  Plus, Trash2, GripVertical, ChevronDown, ChevronUp, CheckCircle2,
  Loader2, ArrowLeft, Save, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  addQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  updatePracticeSheet,
  type PracticeSheet,
  type PracticeSheetQuestion,
  type QuestionType,
  type QuestionInput,
} from '@/services/practiceSheetsService';

interface Props {
  sheet: PracticeSheet;
  onBack: () => void;
  onPreview: () => void;
  onSheetChange: (s: PracticeSheet) => void;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Multiple choice',
  short_answer: 'Short answer',
  free_form: 'Free-form task',
};

interface QuestionDraft {
  id?: string;
  type: QuestionType;
  prompt: string;
  choices: string[];
  correct_answer: string;
  explanation: string;
  isDirty: boolean;
  saving: boolean;
}

function emptyDraft(type: QuestionType = 'multiple_choice'): QuestionDraft {
  return {
    type,
    prompt: '',
    choices: ['', '', '', ''],
    correct_answer: '',
    explanation: '',
    isDirty: false,
    saving: false,
  };
}

function fromQuestion(q: PracticeSheetQuestion): QuestionDraft {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    choices: q.choices ?? ['', '', '', ''],
    correct_answer: q.correct_answer ?? '',
    explanation: q.explanation ?? '',
    isDirty: false,
    saving: false,
  };
}

export function PracticeSheetEditor({ sheet, onBack, onPreview, onSheetChange }: Props) {
  const { toast } = useToast();

  const [title, setTitle] = useState(sheet.title);
  const [savingTitle, setSavingTitle] = useState(false);

  const [questions, setQuestions] = useState<QuestionDraft[]>(
    (sheet.questions ?? []).map(fromQuestion),
  );
  const [addingType, setAddingType] = useState<QuestionType>('multiple_choice');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const setQ = (idx: number, patch: Partial<QuestionDraft>) =>
    setQuestions(prev => prev.map((q, i) => (i === idx ? { ...q, ...patch, isDirty: true } : q)));

  const setOption = (qi: number, oi: number, val: string) =>
    setQuestions(prev =>
      prev.map((q, i) => {
        if (i !== qi) return q;
        const choices = [...q.choices];
        choices[oi] = val;
        return { ...q, choices, isDirty: true };
      }),
    );

  const saveTitle = async () => {
    if (title.trim() === sheet.title) return;
    setSavingTitle(true);
    try {
      const updated = await updatePracticeSheet(sheet.id, { title: title.trim() });
      onSheetChange(updated);
      toast({ title: 'Title saved' });
    } catch (err) {
      toast({ title: 'Failed to save title', variant: 'destructive' });
    } finally {
      setSavingTitle(false);
    }
  };

  const handleAddQuestion = async () => {
    const draft = emptyDraft(addingType);
    const newIdx = questions.length;
    setQuestions(prev => [...prev, draft]);
    setExpandedIdx(newIdx);
  };

  const handleSaveQuestion = async (idx: number) => {
    const draft = questions[idx];
    setQ(idx, { saving: true });

    const input: QuestionInput = {
      type: draft.type,
      prompt: draft.prompt.trim(),
      choices: draft.type === 'multiple_choice' ? draft.choices.filter(Boolean) : undefined,
      correct_answer: draft.correct_answer.trim() || undefined,
      explanation: draft.explanation.trim() || undefined,
      order_index: idx,
    };

    try {
      if (draft.id) {
        const updated = await updateQuestion(sheet.id, draft.id, input);
        setQuestions(prev =>
          prev.map((q, i) => (i === idx ? { ...fromQuestion(updated), isDirty: false, saving: false } : q)),
        );
      } else {
        const created = await addQuestion(sheet.id, input);
        setQuestions(prev =>
          prev.map((q, i) => (i === idx ? { ...fromQuestion(created), isDirty: false, saving: false } : q)),
        );
      }
      toast({ title: 'Question saved' });
    } catch (err) {
      toast({ title: 'Failed to save question', variant: 'destructive' });
      setQ(idx, { saving: false });
    }
  };

  const handleDeleteQuestion = async (idx: number) => {
    const draft = questions[idx];
    if (!window.confirm('Delete this question?')) return;
    if (draft.id) {
      try {
        await deleteQuestion(sheet.id, draft.id);
      } catch (err) {
        toast({ title: 'Failed to delete question', variant: 'destructive' });
        return;
      }
    }
    const next = questions.filter((_, i) => i !== idx);
    setQuestions(next);
    if (expandedIdx === idx) setExpandedIdx(null);
    else if (expandedIdx !== null && expandedIdx > idx) setExpandedIdx(expandedIdx - 1);
  };

  const moveQuestion = async (idx: number, dir: 'up' | 'down') => {
    const other = dir === 'up' ? idx - 1 : idx + 1;
    if (other < 0 || other >= questions.length) return;
    const next = [...questions];
    [next[idx], next[other]] = [next[other], next[idx]];
    setQuestions(next);
    const ids = next.filter(q => q.id).map(q => q.id as string);
    if (ids.length === next.length) {
      try {
        await reorderQuestions(sheet.id, ids);
      } catch {
      }
    }
    if (expandedIdx === idx) setExpandedIdx(other);
    else if (expandedIdx === other) setExpandedIdx(idx);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="mt-0.5 flex-shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-foreground">Edit Sheet</h2>
          <p className="text-xs text-muted-foreground">Add and organise questions.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onPreview} className="gap-1.5 flex-shrink-0">
          <Eye className="w-3.5 h-3.5" /> Preview
        </Button>
      </div>

      {/* Title */}
      <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
        <Label>Sheet title</Label>
        <div className="flex gap-2">
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Sheet title"
            className="flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={saveTitle}
            disabled={savingTitle || title.trim() === sheet.title}
          >
            {savingTitle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-3">
        {questions.map((q, idx) => (
          <div key={q.id ?? `new-${idx}`} className="bg-card rounded-2xl border border-border overflow-hidden">
            {/* Collapsed header */}
            <button
              type="button"
              className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted/30 transition-colors"
              onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
            >
              <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="flex-1 min-w-0 text-sm">
                <span className="font-medium text-foreground truncate block">
                  {q.prompt || <span className="text-muted-foreground italic">Untitled question {idx + 1}</span>}
                </span>
                <span className="text-xs text-muted-foreground">{TYPE_LABELS[q.type]}</span>
              </span>
              {q.isDirty && (
                <span className="text-xs bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full">
                  Unsaved
                </span>
              )}
              {expandedIdx === idx ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
            </button>

            {/* Expanded editor */}
            {expandedIdx === idx && (
              <div className="px-5 pb-5 pt-1 space-y-4 border-t border-border">
                {/* Type selector */}
                <div>
                  <Label className="text-xs mb-1.5 block">Question type</Label>
                  <div className="flex gap-2 flex-wrap">
                    {(['multiple_choice', 'short_answer', 'free_form'] as QuestionType[]).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setQ(idx, { type: t })}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                          q.type === t
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border hover:border-primary/50 text-muted-foreground'
                        }`}
                      >
                        {TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Prompt */}
                <div>
                  <Label className="text-xs mb-1.5 block">Question / prompt</Label>
                  <Textarea
                    value={q.prompt}
                    onChange={e => setQ(idx, { prompt: e.target.value })}
                    rows={3}
                    placeholder="Enter the question…"
                  />
                </div>

                {/* MC options */}
                {q.type === 'multiple_choice' && (
                  <div>
                    <Label className="text-xs mb-1.5 block">
                      Options <span className="text-muted-foreground">(click letter to mark correct)</span>
                    </Label>
                    <div className="space-y-2">
                      {q.choices.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setQ(idx, { correct_answer: opt || String.fromCharCode(65 + oi) })}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
                              q.correct_answer === opt && opt
                                ? 'bg-green-500 text-white'
                                : 'bg-muted text-muted-foreground hover:bg-muted/70'
                            }`}
                          >
                            {q.correct_answer === opt && opt ? (
                              <CheckCircle2 className="w-4 h-4" />
                            ) : (
                              String.fromCharCode(65 + oi)
                            )}
                          </button>
                          <Input
                            value={opt}
                            onChange={e => setOption(idx, oi, e.target.value)}
                            placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                            className="flex-1"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Correct answer for short_answer */}
                {q.type === 'short_answer' && (
                  <div>
                    <Label className="text-xs mb-1.5 block">Model answer (for auto-grading)</Label>
                    <Input
                      value={q.correct_answer}
                      onChange={e => setQ(idx, { correct_answer: e.target.value })}
                      placeholder="Expected answer…"
                    />
                  </div>
                )}

                {/* Model answer for free_form */}
                {q.type === 'free_form' && (
                  <div>
                    <Label className="text-xs mb-1.5 block">Model answer / rubric (optional, shown after submit)</Label>
                    <Textarea
                      value={q.correct_answer}
                      onChange={e => setQ(idx, { correct_answer: e.target.value })}
                      rows={3}
                      placeholder="Suggested answer or grading notes…"
                    />
                  </div>
                )}

                {/* Explanation */}
                <div>
                  <Label className="text-xs mb-1.5 block">Explanation (shown after submit, optional)</Label>
                  <Textarea
                    value={q.explanation}
                    onChange={e => setQ(idx, { explanation: e.target.value })}
                    rows={2}
                    placeholder="Why is this the correct answer?"
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={idx === 0}
                      onClick={() => moveQuestion(idx, 'up')}
                      title="Move up"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={idx === questions.length - 1}
                      onClick={() => moveQuestion(idx, 'down')}
                      title="Move down"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteQuestion(idx)}
                      className="text-destructive hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleSaveQuestion(idx)}
                    disabled={q.saving || !q.prompt.trim()}
                    className="gap-1.5"
                  >
                    {q.saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save question
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add question */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <p className="text-sm font-medium text-foreground mb-3">Add a question</p>
        <div className="flex gap-2 flex-wrap items-center">
          <select
            value={addingType}
            onChange={e => setAddingType(e.target.value as QuestionType)}
            className="text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {(['multiple_choice', 'short_answer', 'free_form'] as QuestionType[]).map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
          <Button type="button" onClick={handleAddQuestion} className="gap-1.5">
            <Plus className="w-4 h-4" /> Add question
          </Button>
        </div>
      </div>
    </div>
  );
}
