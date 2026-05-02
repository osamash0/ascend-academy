/**
 * Reusable worksheets panel.
 *
 * - Read-only mode (students): just lists worksheets with download buttons.
 * - Editable mode (professors): adds upload, rename and delete affordances.
 */
import { useEffect, useRef, useState } from 'react';
import { FileText, Upload, Loader2, Trash2, Pencil, Download, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  listWorksheets,
  uploadWorksheet,
  deleteWorksheet,
  renameWorksheet,
  getWorksheetDownloadUrl,
  type Worksheet,
} from '@/services/worksheetsService';

interface Props {
  lectureId: string;
  editable?: boolean;
}

function formatBytes(n: number | null): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorksheetsPanel({ lectureId, editable = false }: Props) {
  const { toast } = useToast();
  const [items, setItems] = useState<Worksheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setItems(await listWorksheets(lectureId));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [lectureId]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      await uploadWorksheet(lectureId, f);
      toast({ title: 'Worksheet uploaded' });
      await refresh();
    } catch (err) {
      toast({ title: 'Upload failed', description: String(err), variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDownload = async (id: string) => {
    try {
      const { url } = await getWorksheetDownloadUrl(id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast({ title: 'Download failed', variant: 'destructive' });
    }
  };

  const handleRename = async (id: string) => {
    const title = editingTitle.trim();
    if (!title) return;
    try {
      await renameWorksheet(id, title);
      setEditingId(null);
      setEditingTitle('');
      await refresh();
    } catch (e) {
      toast({ title: 'Rename failed', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this worksheet?')) return;
    try {
      await deleteWorksheet(id);
      await refresh();
    } catch (e) {
      toast({ title: 'Delete failed', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Worksheets</h3>
          <span className="text-xs text-muted-foreground">({items.length})</span>
        </div>
        {editable && (
          <>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={onPick}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="gap-2"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Upload
            </Button>
          </>
        )}
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No worksheets attached.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((w) => (
            <li
              key={w.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30"
            >
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                {editingId === w.id ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      className="h-7 text-sm"
                      autoFocus
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRename(w.id)}>
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingId(null); setEditingTitle(''); }}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground truncate">{w.title}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(w.size_bytes)}</p>
                  </>
                )}
              </div>
              {editingId !== w.id && (
                <div className="flex items-center gap-0.5">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDownload(w.id)} title="Download">
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                  {editable && (
                    <>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => { setEditingId(w.id); setEditingTitle(w.title); }}
                        title="Rename"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                        onClick={() => handleDelete(w.id)}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
