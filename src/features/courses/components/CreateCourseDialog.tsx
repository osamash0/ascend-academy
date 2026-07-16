import { useEffect, useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  createCourse,
  updateCourse,
  generateCourseDescription,
  type Course,
} from '@/services/coursesService';

export const COLOR_SWATCHES = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f59e0b', '#10b981', '#06b6d4', '#3b82f6',
];

export interface CreateCourseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingCourse?: Course | null;
  onSuccess: (course: Course) => void;
}

export function CreateCourseDialog({ open, onOpenChange, editingCourse, onSuccess }: CreateCourseDialogProps) {
  const { toast } = useToast();
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<string>(COLOR_SWATCHES[0]);
  const [saving, setSaving] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);

  useEffect(() => {
    if (open) {
      if (editingCourse) {
        setTitle(editingCourse.title);
        setDescription(editingCourse.description ?? '');
        setColor(editingCourse.color ?? COLOR_SWATCHES[0]);
      } else {
        setTitle('');
        setDescription('');
        setColor(COLOR_SWATCHES[0]);
      }
    }
  }, [open, editingCourse]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast({ title: 'Title is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      let savedCourse: Course;
      if (editingCourse) {
        savedCourse = await updateCourse(editingCourse.id, { title: title.trim(), description: description.trim() || null, color });
        toast({ title: 'Course updated' });
      } else {
        savedCourse = await createCourse({ title: title.trim(), description: description.trim() || undefined, color });
        toast({ title: 'Course created' });
      }
      onSuccess(savedCourse);
    } catch (e) {
      console.error(e);
      toast({ title: 'Save failed', description: String(e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateDescription = async () => {
    if (!editingCourse) return;
    setGeneratingDesc(true);
    try {
      const desc = await generateCourseDescription(editingCourse.id);
      setDescription(desc);
      toast({ title: 'Description generated' });
    } catch (e) {
      console.error(e);
      toast({ title: 'Generation failed', variant: 'destructive' });
    } finally {
      setGeneratingDesc(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingCourse ? 'Edit course' : 'New course'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="course-title">Title</Label>
            <Input id="course-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Database Management" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="course-desc">Description</Label>
              {editingCourse && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs text-primary hover:text-primary"
                  onClick={handleGenerateDescription}
                  disabled={generatingDesc || editingCourse.lecture_count === 0}
                  title={
                    editingCourse.lecture_count === 0
                      ? 'Add lectures to this course first'
                      : 'Generate a description from this course’s lectures'
                  }
                >
                  {generatingDesc ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {generatingDesc ? 'Generating…' : 'Generate with AI'}
                </Button>
              )}
            </div>
            <Textarea id="course-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Optional summary…" />
          </div>
          <div>
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-lg border-2 transition-all ${
                    color === c ? 'border-foreground scale-110' : 'border-transparent'
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {editingCourse ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
