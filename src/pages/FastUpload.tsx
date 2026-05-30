import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { UploadCloud, FileText, X, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type UploadState = "idle" | "uploading" | "processing" | "done" | "error";

export default function FastUpload() {
  const navigate = useNavigate();
  const [state, setState] = useState<UploadState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [lectureId, setLectureId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

  function handleFile(f: File) {
    if (!f.name.endsWith(".pdf") && f.type !== "application/pdf") {
      setError("Only PDF files are supported.");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setError("File must be under 50MB.");
      return;
    }
    setFile(f);
    setError(null);
    setState("idle");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  }

  async function handleUpload() {
    if (!file) return;
    setState("uploading");
    setError(null);
    setProgress(10);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.append("file", file);

      setProgress(30);
      const res = await fetch(`${API_BASE}/api/fast-upload/`, { 
        method: "POST", 
        body: form,
        headers: {
          Authorization: `Bearer ${session?.access_token}`
        }
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(err.detail || "Upload failed");
      }

      const upload = await res.json();
      setProgress(60);
      setState("processing");

      let attempts = 0;
      const poll = async () => {
        attempts++;
        setProgress(Math.min(60 + Math.log1p(attempts) * 8, 95));
        try {
          const r = await fetch(`${API_BASE}/api/fast-upload/status/${upload.id}`, {
            headers: {
              Authorization: `Bearer ${session?.access_token}`
            }
          });
          const u = await r.json();

          if (u.status === "completed" && u.lectureId) {
            setProgress(100);
            setState("done");
            setLectureId(u.lectureId);
          } else if (u.status === "error" || u.status === "failed") {
            throw new Error(u.errorMessage || "Processing failed");
          } else {
            setTimeout(poll, 3000);
          }
        } catch (pollErr) {
          setState("error");
          setError(pollErr instanceof Error ? pollErr.message : "Something went wrong");
        }
      };
      poll();
    } catch (err: unknown) {
      setState("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  function reset() {
    setState("idle");
    setFile(null);
    setError(null);
    setProgress(0);
    setLectureId(null);
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Fast Upload Lecture</h1>
        <p className="text-muted-foreground text-sm mt-1">Upload a PDF to process it through the isolated AI pipeline</p>
      </div>

      {state === "done" ? (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="pt-6 text-center space-y-4">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
            <div>
              <p className="font-semibold text-lg">Processing complete!</p>
              <p className="text-sm text-muted-foreground mt-1">Your lecture has been analyzed and is ready to view.</p>
            </div>
            <div className="flex gap-3 justify-center">
              {/* Navigate via react-router instead of window.location.href */}
              <Button onClick={() => navigate(`/professor/lecture/${lectureId}`)}>View Lecture</Button>
              <Button variant="outline" onClick={reset}>Upload Another</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !file && inputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer",
              dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
              file ? "cursor-default" : ""
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="w-8 h-8 text-primary shrink-0" />
                <div className="text-left min-w-0">
                  <p className="font-medium truncate max-w-sm">{file.name}</p>
                  <p className="text-sm text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                {state === "idle" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); reset(); }}
                    className="ml-2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <UploadCloud className="w-12 h-12 text-muted-foreground mx-auto" />
                <div>
                  <p className="font-medium">Drop your PDF here or click to browse</p>
                  <p className="text-sm text-muted-foreground mt-1">Supports PDF files up to 50MB</p>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 text-destructive bg-destructive/10 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {(state === "uploading" || state === "processing") && (
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span>{state === "uploading" ? "Uploading file…" : "AI pipeline processing slides…"}</span>
                  </div>
                  <span className="text-muted-foreground">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-2" />
                {state === "processing" && (
                  <p className="text-xs text-muted-foreground">
                    Extracting slide content, generating AI insights and quiz questions. This may take a minute.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleUpload}
              disabled={!file || state === "uploading" || state === "processing"}
              className="min-w-32"
            >
              {state === "uploading" || state === "processing" ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing</>
              ) : (
                <><UploadCloud className="w-4 h-4 mr-2" /> Upload & Process</>
              )}
            </Button>
          </div>
        </>
      )}

      <Card className="bg-muted/30">
        <CardContent className="pt-5 pb-5">
          <p className="text-sm font-medium mb-2">What happens when you upload?</p>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>PDF is parsed and each page is extracted as a slide</li>
            <li>GPT analyzes each slide: generates a title, insight, and context note</li>
            <li>Lecture-level metadata is extracted: subject, course code, summary, key topics</li>
            <li>Quiz questions are generated for the full lecture</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
