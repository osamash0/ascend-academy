import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  FlaskConical, Upload, FileText, Play, X, Download,
  ChevronRight, Loader2, CheckCircle2, Circle, AlertCircle,
  ScanText,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type SSEEventType = 'info' | 'meta' | 'phase' | 'progress' | 'slide' | 'deck_complete' | 'complete' | 'partial_complete' | 'error'

interface RawPage {
  page_num: number
  title: string | null
  text: string
  char_count: number
  word_count: number
}

interface RawParseResult {
  parser_used: string
  total_pages: number
  pages: RawPage[]
}
type ParserChoice = 'auto' | 'pymupdf' | 'opendataloader' | 'llamaparse' | 'mineru'
type AIModel = 'cerebras' | 'groq' | 'gemini' | 'mistral'

interface SSEEvent {
  id: string
  timestamp: Date
  type: SSEEventType
  raw: Record<string, unknown>
}

interface LayoutFeatures {
  word_count: number
  image_coverage: number
  drawing_count: number
  alpha_ratio: number
  has_math: boolean
  has_table: boolean
  column_count: number
}

interface SlideMeta {
  filename: string
  page: number
  type: string
  engine: string
  tokens: number
  parse_time_ms: number
  route: string
  route_reason: string
  layout_features: LayoutFeatures
}

interface SlideQuestion {
  question: string
  options: string[]
  answer: 'A' | 'B' | 'C' | 'D'
  explanation: string
  concept: string
  cognitive_level: 'recall' | 'apply' | 'analyze' | 'evaluate'
  linked_slides: number[]
}

interface SlidePayload {
  index: number
  title: string
  content: string
  summary: string
  questions: SlideQuestion[]
  slide_type: string
  is_metadata: boolean
  parse_error?: string
  _meta: SlideMeta
}

interface SlideEvaluation {
  rating: 'good' | 'bad' | 'needs_review' | null
  note: string
}

interface TestRun {
  file: File | null
  events: SSEEvent[]
  slides: SlidePayload[]
  deckSummary: string
  deckQuiz: Record<string, unknown>[]
  phase: string
  progress: { current: number; total: number }
  parserUsed: string
  isRunning: boolean
  error: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const EMPTY_RUN: TestRun = {
  file: null, events: [], slides: [], deckSummary: '',
  deckQuiz: [], phase: '', progress: { current: 0, total: 0 },
  parserUsed: '', isRunning: false, error: null,
}

const EVENT_TYPE_COLORS: Record<SSEEventType, string> = {
  info:          'bg-blue-500/20 text-blue-400 border-blue-500/30',
  meta:          'bg-slate-500/20 text-slate-400 border-slate-500/30',
  phase:         'bg-purple-500/20 text-purple-400 border-purple-500/30',
  progress:      'bg-gray-500/20 text-gray-400 border-gray-500/30',
  slide:         'bg-green-500/20 text-green-400 border-green-500/30',
  deck_complete: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  complete:         'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  partial_complete: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  error:            'bg-red-500/20 text-red-400 border-red-500/30',
}

const ROUTE_COLORS: Record<string, string> = {
  TEXT:       'bg-blue-500/15 text-blue-300 border-blue-500/20',
  VISION:     'bg-violet-500/15 text-violet-300 border-violet-500/20',
  TABLE_ODL:  'bg-amber-500/15 text-amber-300 border-amber-500/20',
  TABLE_LLM:  'bg-orange-500/15 text-orange-300 border-orange-500/20',
  SKIP:       'bg-gray-500/15 text-gray-400 border-gray-500/20',
}

const EVAL_BORDER: Record<string, string> = {
  good:         'border-green-500/60',
  bad:          'border-red-500/60',
  needs_review: 'border-yellow-500/60',
}

const PHASES = ['extract', 'enhance', 'finalize']

function formatTimestamp(d: Date): string {
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

// ─── Inline sub-components ───────────────────────────────────────────────────

function LayoutGrid({ features, meta }: { features?: LayoutFeatures; meta?: SlideMeta }) {
  if (!features) return <p className="text-xs text-muted-foreground p-2">No layout data available.</p>
  const items: { label: string; value: string | number }[] = [
    { label: 'Words',         value: features.word_count },
    { label: 'Image coverage',value: `${(features.image_coverage * 100).toFixed(1)}%` },
    { label: 'Drawings',      value: features.drawing_count },
    { label: 'Alpha ratio',   value: `${(features.alpha_ratio * 100).toFixed(1)}%` },
    { label: 'Has math',      value: features.has_math ? 'Yes' : 'No' },
    { label: 'Has table',     value: features.has_table ? 'Yes' : 'No' },
    { label: 'Columns',       value: features.column_count },
    { label: 'Engine',        value: meta?.engine ?? '—' },
    { label: 'Tokens',        value: meta?.tokens ?? 0 },
    { label: 'Parse time',    value: `${meta?.parse_time_ms ?? 0} ms` },
  ]
  return (
    <div className="grid grid-cols-2 gap-2 p-2">
      {items.map(({ label, value }) => (
        <div key={label} className="bg-muted/30 rounded p-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
          <p className="text-sm font-mono font-semibold">{String(value)}</p>
        </div>
      ))}
    </div>
  )
}

function AIOutputPanel({ slide }: { slide: SlidePayload }) {
  return (
    <div className="space-y-3 p-2">
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Title</p>
        <p className="text-sm font-medium">{slide.title || <span className="italic text-muted-foreground">—</span>}</p>
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Content</p>
        <div className="h-40 overflow-y-auto rounded border border-border">
          <pre className="text-xs font-mono whitespace-pre-wrap bg-muted/30 p-2">{slide.content || '—'}</pre>
        </div>
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Summary</p>
        <p className="text-xs text-muted-foreground">{slide.summary || '—'}</p>
      </div>
      {slide._meta?.route_reason && (
        <div className="text-xs text-muted-foreground border border-border/50 rounded px-2 py-1.5 bg-muted/20">
          <span className="font-medium text-foreground">Route reason: </span>
          {slide._meta.route_reason}
        </div>
      )}
      {slide.parse_error && (
        <div className="text-xs text-destructive border border-destructive/30 rounded px-2 py-1.5 bg-destructive/10">
          <AlertCircle size={11} className="inline mr-1" />
          {slide.parse_error}
        </div>
      )}
    </div>
  )
}

function QuestionsPanel({ questions }: { questions?: SlideQuestion[] }) {
  if (!questions?.length) return <p className="text-xs text-muted-foreground p-2">No questions generated.</p>
  return (
    <div className="space-y-3 p-2">
      {questions.map((q, qi) => (
        <div key={qi} className="border border-border rounded p-3 space-y-2">
          <p className="text-sm font-medium">{q.question}</p>
          <div className="space-y-1">
            {q.options?.map((opt, oi) => {
              const letter = String.fromCharCode(65 + oi) as 'A' | 'B' | 'C' | 'D'
              const isCorrect = letter === q.answer
              return (
                <div
                  key={oi}
                  className={cn(
                    'text-xs px-2 py-1 rounded',
                    isCorrect
                      ? 'bg-green-500/20 text-green-300 font-medium ring-1 ring-green-500/30'
                      : 'text-muted-foreground'
                  )}
                >
                  {letter}. {opt}
                </div>
              )
            })}
          </div>
          {q.explanation && (
            <p className="text-xs text-muted-foreground italic border-t border-border/50 pt-2">
              {q.explanation}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {q.concept && <Badge variant="outline" className="text-[10px] h-5">{q.concept}</Badge>}
            {q.cognitive_level && <Badge variant="secondary" className="text-[10px] h-5">{q.cognitive_level}</Badge>}
            {q.linked_slides?.length > 0 && (
              <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground">
                slides: {q.linked_slides.join(', ')}
              </Badge>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function EvaluationRow({
  evaluation,
  onChange,
}: {
  evaluation: SlideEvaluation
  onChange: (patch: Partial<SlideEvaluation>) => void
}) {
  return (
    <div className="p-3 space-y-2 bg-muted/10">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Evaluate:</span>
        {(['good', 'bad', 'needs_review'] as const).map(r => (
          <Button
            key={r}
            variant={evaluation.rating === r ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => onChange({ rating: evaluation.rating === r ? null : r })}
          >
            {r === 'good' ? '👍 Good' : r === 'bad' ? '👎 Bad' : '⚠️ Review'}
          </Button>
        ))}
      </div>
      <Textarea
        placeholder="Notes (optional)..."
        className="text-xs min-h-[44px] resize-none"
        value={evaluation.note}
        onChange={e => onChange({ note: e.target.value })}
      />
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PipelineTestPage() {
  const { session } = useAuth()

  const [run, setRun] = useState<TestRun>(EMPTY_RUN)
  const [parser, setParser] = useState<ParserChoice>('auto')
  const [aiModel, setAIModel] = useState<AIModel>('cerebras')
  const [useBlueprint, setUseBlueprint] = useState(false)
  const [forceReparse, setForceReparse] = useState(false)

  const [activeTab, setActiveTab] = useState<'events' | 'slides' | 'deck'>('events')
  const [dragOver, setDragOver] = useState(false)
  const [expandedSlides, setExpandedSlides] = useState<Set<number>>(new Set())
  const [slideSubTabs, setSlideSubTabs] = useState<Record<number, string>>({})
  const [evaluations, setEvaluations] = useState<Record<number, SlideEvaluation>>({})

  // Raw parse (parser-only, no AI)
  const [rawParse, setRawParse] = useState<RawParseResult | null>(null)
  const [rawParseError, setRawParseError] = useState<string | null>(null)
  const [isParsingRaw, setIsParsingRaw] = useState(false)
  const [rawSheetOpen, setRawSheetOpen] = useState(false)
  const [rawPageSearch, setRawPageSearch] = useState('')

  const abortRef = useRef<AbortController | null>(null)
  const eventLogRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll event log
  useEffect(() => {
    if (eventLogRef.current) {
      eventLogRef.current.scrollTop = eventLogRef.current.scrollHeight
    }
  }, [run.events.length])

  // Derived stats
  const stats = useMemo(() => {
    const slides = run.slides.filter(Boolean)
    let text = 0, vision = 0, table = 0, skip = 0, totalTokens = 0, totalParseMs = 0
    for (const s of slides) {
      const route = s._meta?.route ?? ''
      if (route === 'TEXT') text++
      else if (route === 'VISION') vision++
      else if (route.startsWith('TABLE')) table++
      else if (route === 'SKIP') skip++
      totalTokens += s._meta?.tokens ?? 0
      totalParseMs += s._meta?.parse_time_ms ?? 0
    }
    return { text, vision, table, skip, totalTokens, totalParseMs, totalSlides: slides.length }
  }, [run.slides])

  const setFile = useCallback((file: File | null) => {
    setRun(prev => ({ ...prev, file }))
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file?.type === 'application/pdf') setFile(file)
  }, [setFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setFile(file)
  }, [setFile])

  const fetchRawParse = useCallback(async () => {
    if (!run.file || !session?.access_token) return
    setIsParsingRaw(true)
    setRawParseError(null)
    setRawParse(null)
    setRawPageSearch('')

    const formData = new FormData()
    formData.append('file', run.file)
    formData.append('parser', parser)

    try {
      const res = await fetch(`${API_BASE}/api/upload/parse-raw`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const data: RawParseResult = await res.json()
      setRawParse(data)
      setRawSheetOpen(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Raw parse failed'
      setRawParseError(msg)
    } finally {
      setIsParsingRaw(false)
    }
  }, [run.file, session, parser])

  const runPipeline = useCallback(async () => {
    if (!run.file || !session?.access_token) return

    const file = run.file
    setRun({ ...EMPTY_RUN, file, isRunning: true })
    setActiveTab('events')
    setEvaluations({})
    setExpandedSlides(new Set())

    const formData = new FormData()
    formData.append('file', file)
    formData.append('ai_model', aiModel)
    formData.append('parser', parser)
    formData.append('use_blueprint', String(useBlueprint))
    formData.append('force_reparse', String(forceReparse))

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch(`${API_BASE}/api/upload/parse-pdf-stream`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText)
        throw new Error(`HTTP ${response.status}: ${text}`)
      }

      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''

        for (const chunk of chunks) {
          const line = chunk.trim()
          if (!line.startsWith('data: ')) continue
          let payload: Record<string, unknown>
          try {
            payload = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          const eventType = payload.type as SSEEventType
          const event: SSEEvent = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            type: eventType,
            raw: payload,
          }

          setRun(prev => {
            const next: TestRun = { ...prev, events: [...prev.events, event] }

            switch (eventType) {
              case 'info':
                next.parserUsed = String(payload.parser ?? '')
                break
              case 'phase':
                next.phase = String(payload.phase ?? '')
                break
              case 'progress':
                next.progress = {
                  current: Number(payload.current ?? 0),
                  total: Number(payload.total ?? 0),
                }
                break
              case 'slide': {
                const slide = payload.slide as SlidePayload
                const idx = Number(payload.index ?? 0)
                const slides = [...next.slides]
                slides[idx] = { ...slide, index: idx }
                next.slides = slides
                break
              }
              case 'deck_complete':
                next.deckSummary = String(payload.deck_summary ?? '')
                next.deckQuiz = Array.isArray(payload.deck_quiz) ? payload.deck_quiz : []
                break
              case 'complete':
              case 'partial_complete':
                next.isRunning = false
                break
              case 'error':
                next.error = String(payload.message ?? 'Unknown error')
                next.isRunning = false
                break
            }
            return next
          })
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setRun(prev => ({ ...prev, isRunning: false }))
        return
      }
      const msg = err instanceof Error ? err.message : 'Pipeline failed'
      setRun(prev => ({ ...prev, isRunning: false, error: msg }))
    } finally {
      abortRef.current = null
    }
  }, [run.file, session, parser, aiModel, useBlueprint, forceReparse])

  const cancelPipeline = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const exportEvaluations = useCallback(() => {
    const data = run.slides.filter(Boolean).map((slide, i) => ({
      index: i,
      title: slide.title,
      route: slide._meta?.route,
      evaluation: evaluations[i] ?? { rating: null, note: '' },
    }))
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pipeline-eval-${run.file?.name ?? 'unknown'}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [run.slides, evaluations, run.file])

  const currentPhaseIdx = PHASES.indexOf(run.phase)
  const slideCount = run.slides.filter(Boolean).length
  const progressPercent = run.progress.total > 0
    ? Math.round((run.progress.current / run.progress.total) * 100)
    : 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <FlaskConical className="h-4 w-4 text-primary" />
          <h1 className="text-base font-bold">Pipeline Test Lab</h1>
          {run.parserUsed && (
            <Badge variant="outline" className="text-[11px] h-5">{run.parserUsed}</Badge>
          )}
        </div>
        {stats.totalSlides > 0 && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{stats.totalSlides} slides</span>
            <span className="text-blue-400">T:{stats.text}</span>
            <span className="text-violet-400">V:{stats.vision}</span>
            <span className="text-amber-400">Tbl:{stats.table}</span>
            <span className="text-gray-400">Skip:{stats.skip}</span>
            <span>{stats.totalTokens.toLocaleString()} tok</span>
            <span>{(stats.totalParseMs / 1000).toFixed(1)}s</span>
          </div>
        )}
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <aside className="w-64 shrink-0 flex flex-col gap-3 p-4 border-r border-border overflow-y-auto">
          {/* Upload zone */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileInput}
            />
            <div
              className={cn(
                'border-2 border-dashed rounded-lg cursor-pointer text-center p-4 transition-colors',
                dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
                run.file ? 'border-green-500/50 bg-green-500/5' : ''
              )}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {run.file ? (
                <>
                  <FileText className="h-6 w-6 mx-auto mb-1.5 text-green-400" />
                  <p className="text-xs font-medium text-green-400 truncate">{run.file.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {(run.file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </>
              ) : (
                <>
                  <Upload className="h-6 w-6 mx-auto mb-1.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Drop PDF or click</p>
                </>
              )}
            </div>
          </div>

          {/* Parser */}
          <div className="space-y-1">
            <Label className="text-xs">Parser</Label>
            <Select value={parser} onValueChange={v => setParser(v as ParserChoice)} disabled={run.isRunning}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="pymupdf">PyMuPDF</SelectItem>
                <SelectItem value="opendataloader">OpenDataLoader</SelectItem>
                <SelectItem value="llamaparse">LlamaParse</SelectItem>
                <SelectItem value="mineru">MinerU</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* AI Model */}
          <div className="space-y-1">
            <Label className="text-xs">AI Model</Label>
            <Select value={aiModel} onValueChange={v => setAIModel(v as AIModel)} disabled={run.isRunning}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cerebras">Cerebras</SelectItem>
                <SelectItem value="groq">Groq</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="mistral">Mistral</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Checkboxes */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="blueprint"
                checked={useBlueprint}
                onCheckedChange={v => setUseBlueprint(!!v)}
                disabled={run.isRunning}
              />
              <Label htmlFor="blueprint" className="text-xs cursor-pointer">Use Blueprint</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="force"
                checked={forceReparse}
                onCheckedChange={v => setForceReparse(!!v)}
                disabled={run.isRunning}
              />
              <Label htmlFor="force" className="text-xs cursor-pointer">Force Reparse</Label>
            </div>
          </div>

          {/* Buttons */}
          <div className="space-y-2">
            {/* Parse-only button — runs just the text extractor, no AI */}
            <Button
              variant="outline"
              className="w-full h-8 text-xs"
              onClick={fetchRawParse}
              disabled={!run.file || run.isRunning || isParsingRaw}
            >
              {isParsingRaw
                ? <><Loader2 size={13} className="animate-spin mr-1.5" />Parsing...</>
                : <><ScanText size={13} className="mr-1.5" />Parser Output</>
              }
            </Button>
            {rawParseError && (
              <p className="text-[10px] text-destructive leading-tight">{rawParseError}</p>
            )}
            {rawParse && !rawSheetOpen && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs text-muted-foreground"
                onClick={() => setRawSheetOpen(true)}
              >
                View last parse ({rawParse.total_pages} pages)
              </Button>
            )}
            <Button
              className="w-full h-8 text-xs"
              onClick={runPipeline}
              disabled={!run.file || run.isRunning}
            >
              {run.isRunning
                ? <><Loader2 size={13} className="animate-spin mr-1.5" />Running...</>
                : <><Play size={13} className="mr-1.5" />Run Pipeline</>
              }
            </Button>
            {run.isRunning && (
              <Button variant="outline" className="w-full h-8 text-xs" onClick={cancelPipeline}>
                <X size={13} className="mr-1.5" />Cancel
              </Button>
            )}
          </div>

          <Separator />

          {/* Phase indicator */}
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Phase</p>
            {PHASES.map((p, i) => (
              <div
                key={p}
                className={cn(
                  'flex items-center gap-1.5 text-xs px-2 py-1 rounded',
                  i < currentPhaseIdx  ? 'text-green-400 bg-green-500/10' :
                  i === currentPhaseIdx && run.isRunning ? 'text-primary bg-primary/10' :
                  i === currentPhaseIdx && !run.isRunning && run.phase ? 'text-green-400 bg-green-500/10' :
                  'text-muted-foreground'
                )}
              >
                {i < currentPhaseIdx || (i === currentPhaseIdx && !run.isRunning && run.phase)
                  ? <CheckCircle2 size={11} />
                  : i === currentPhaseIdx && run.isRunning
                  ? <Loader2 size={11} className="animate-spin" />
                  : <Circle size={11} />
                }
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </div>
            ))}
          </div>

          {/* Progress */}
          {(run.isRunning || run.progress.total > 0) && (
            <div className="space-y-1">
              <Progress value={progressPercent} className="h-1.5" />
              <p className="text-[10px] text-muted-foreground text-center">
                {run.progress.current} / {run.progress.total} slides
              </p>
            </div>
          )}

          {/* Error */}
          {run.error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertCircle size={11} className="inline mr-1" />
              {run.error}
            </div>
          )}

          <Separator />

          {/* Export */}
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs"
            disabled={Object.keys(evaluations).length === 0}
            onClick={exportEvaluations}
          >
            <Download size={13} className="mr-1.5" />Export Evaluations
          </Button>
        </aside>

        {/* Right panel */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <Tabs
            value={activeTab}
            onValueChange={v => setActiveTab(v as typeof activeTab)}
            className="flex flex-col flex-1 overflow-hidden"
          >
            <div className="px-4 pt-3 shrink-0">
              <TabsList className="h-8">
                <TabsTrigger value="events" className="text-xs h-7 px-3">
                  Events {run.events.length > 0 && `(${run.events.length})`}
                </TabsTrigger>
                <TabsTrigger value="slides" className="text-xs h-7 px-3">
                  Slides {slideCount > 0 && `(${slideCount})`}
                </TabsTrigger>
                <TabsTrigger value="deck" className="text-xs h-7 px-3">
                  Deck
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Events tab */}
            <TabsContent value="events" className="flex-1 overflow-hidden mt-2">
              <div
                ref={eventLogRef}
                className="overflow-y-auto h-full px-4 pb-4 space-y-px"
              >
                {run.events.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">
                    No events yet. Run the pipeline to see SSE events.
                  </div>
                ) : (
                  run.events.map(ev => (
                    <div
                      key={ev.id}
                      className="flex items-start gap-2 py-1 border-b border-border/20 text-xs font-mono"
                    >
                      <span className="text-muted-foreground shrink-0 w-28 tabular-nums">
                        [{formatTimestamp(ev.timestamp)}]
                      </span>
                      <Badge
                        className={cn(
                          'shrink-0 text-[10px] px-1.5 h-4 rounded border',
                          EVENT_TYPE_COLORS[ev.type] ?? ''
                        )}
                      >
                        {ev.type}
                      </Badge>
                      <span className="text-muted-foreground break-all flex-1 leading-relaxed">
                        {JSON.stringify(ev.raw).slice(0, 160)}
                        {JSON.stringify(ev.raw).length > 160 && '…'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>

            {/* Slides tab */}
            <TabsContent value="slides" className="flex-1 overflow-hidden mt-2">
              <ScrollArea className="h-full px-4 pb-4">
                {slideCount === 0 ? (
                  <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">
                    No slides yet. Run the pipeline to see results.
                  </div>
                ) : (
                  run.slides.filter(Boolean).map((slide) => {
                    const i = slide.index
                    const eval_ = evaluations[i] ?? { rating: null, note: '' }
                    const isExpanded = expandedSlides.has(i)
                    const subTab = slideSubTabs[i] ?? 'layout'
                    const borderClass = eval_.rating ? EVAL_BORDER[eval_.rating] : 'border-border'

                    return (
                      <Collapsible
                        key={i}
                        open={isExpanded}
                        onOpenChange={open => {
                          setExpandedSlides(prev => {
                            const next = new Set(prev)
                            if (open) {
                              next.add(i)
                            } else {
                              next.delete(i)
                            }
                            return next
                          })
                        }}
                      >
                        <Card className={cn('mb-2 border overflow-hidden', borderClass)}>
                          {/* Card header */}
                          <CollapsibleTrigger asChild>
                            <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
                              <ChevronRight
                                className={cn(
                                  'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                                  isExpanded && 'rotate-90'
                                )}
                              />
                              <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-6">
                                #{i}
                              </span>
                              <span className="font-medium text-sm truncate flex-1 min-w-0">
                                {slide.title || <span className="italic text-muted-foreground text-xs">Untitled</span>}
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                {slide.slide_type && (
                                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                                    {slide.slide_type}
                                  </Badge>
                                )}
                                {slide._meta?.route && (
                                  <Badge
                                    className={cn(
                                      'text-[10px] h-4 px-1 border',
                                      ROUTE_COLORS[slide._meta.route] ?? 'bg-muted text-muted-foreground'
                                    )}
                                  >
                                    {slide._meta.route}
                                  </Badge>
                                )}
                                {slide.is_metadata && (
                                  <Badge variant="secondary" className="text-[10px] h-4 px-1">meta</Badge>
                                )}
                                {slide.parse_error && (
                                  <AlertCircle size={13} className="text-destructive" />
                                )}
                              </div>
                            </div>
                          </CollapsibleTrigger>

                          {/* Expanded content */}
                          <CollapsibleContent>
                            <Separator />
                            <Tabs
                              value={subTab}
                              onValueChange={t => setSlideSubTabs(prev => ({ ...prev, [i]: t }))}
                              className="p-2"
                            >
                              <TabsList className="h-7 mb-2">
                                <TabsTrigger value="layout" className="text-[11px] h-6 px-2">Layout</TabsTrigger>
                                <TabsTrigger value="ai" className="text-[11px] h-6 px-2">AI Output</TabsTrigger>
                                <TabsTrigger value="questions" className="text-[11px] h-6 px-2">
                                  Questions {slide.questions?.length ? `(${slide.questions.length})` : ''}
                                </TabsTrigger>
                                <TabsTrigger value="raw" className="text-[11px] h-6 px-2">Raw JSON</TabsTrigger>
                              </TabsList>

                              <TabsContent value="layout">
                                <LayoutGrid features={slide._meta?.layout_features} meta={slide._meta} />
                              </TabsContent>

                              <TabsContent value="ai">
                                <AIOutputPanel slide={slide} />
                              </TabsContent>

                              <TabsContent value="questions">
                                <QuestionsPanel questions={slide.questions} />
                              </TabsContent>

                              <TabsContent value="raw">
                                <div className="h-56 overflow-y-auto rounded border border-border">
                                  <pre className="text-[11px] font-mono bg-muted/30 p-3 whitespace-pre-wrap break-all">
                                    {JSON.stringify(slide, null, 2)}
                                  </pre>
                                </div>
                              </TabsContent>
                            </Tabs>

                            <Separator />
                            <EvaluationRow
                              evaluation={eval_}
                              onChange={patch => setEvaluations(prev => ({
                                ...prev,
                                [i]: { ...eval_, ...patch },
                              }))}
                            />
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>
                    )
                  })
                )}
              </ScrollArea>
            </TabsContent>

            {/* Deck tab */}
            <TabsContent value="deck" className="flex-1 overflow-hidden mt-2">
              <ScrollArea className="h-full px-4 pb-4">
                {!run.deckSummary && run.deckQuiz.length === 0 && stats.totalSlides === 0 ? (
                  <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">
                    No deck data yet. Run the pipeline to completion.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Summary */}
                    <Card className="p-4">
                      <h3 className="text-sm font-semibold mb-2">Deck Summary</h3>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                        {run.deckSummary || 'Not yet generated.'}
                      </p>
                    </Card>

                    {/* Pipeline stats */}
                    {stats.totalSlides > 0 && (
                      <Card className="p-4">
                        <h3 className="text-sm font-semibold mb-3">Pipeline Statistics</h3>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            ['Total slides', stats.totalSlides],
                            ['Text', stats.text],
                            ['Vision', stats.vision],
                            ['Table', stats.table],
                            ['Skipped', stats.skip],
                            ['Total tokens', stats.totalTokens.toLocaleString()],
                            ['Parse time', `${(stats.totalParseMs / 1000).toFixed(1)}s`],
                          ].map(([label, value]) => (
                            <div key={String(label)} className="bg-muted/30 rounded p-2 text-center">
                              <p className="text-[10px] text-muted-foreground">{label}</p>
                              <p className="text-lg font-bold font-mono">{value}</p>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}

                    {/* Cross-slide quiz */}
                    {run.deckQuiz.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold mb-2">
                          Cross-Slide Quiz ({run.deckQuiz.length})
                        </h3>
                        <QuestionsPanel questions={run.deckQuiz as unknown as SlideQuestion[]} />
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </main>
      </div>

      {/* ── Parser Output Sheet ─────────────────────────────────────────── */}
      <Sheet open={rawSheetOpen} onOpenChange={setRawSheetOpen}>
        <SheetContent side="right" className="w-[600px] sm:w-[700px] flex flex-col p-0 gap-0">
          <SheetHeader className="px-5 py-3 border-b border-border shrink-0">
            <SheetTitle className="flex items-center gap-2 text-base">
              <ScanText size={16} className="text-primary" />
              Parser Output
              {rawParse && (
                <Badge variant="outline" className="text-[11px] h-5 ml-1">
                  {rawParse.parser_used}
                </Badge>
              )}
              {rawParse && (
                <span className="text-xs font-normal text-muted-foreground ml-auto">
                  {rawParse.total_pages} pages
                </span>
              )}
            </SheetTitle>
            {rawParse && (
              <p className="text-xs text-muted-foreground">
                Raw text extracted by the parser — before any AI processing or layout analysis.
              </p>
            )}
          </SheetHeader>

          {rawParse && (
            <>
              {/* Search bar */}
              <div className="px-4 py-2 border-b border-border shrink-0">
                <input
                  type="text"
                  placeholder="Search text across all pages..."
                  value={rawPageSearch}
                  onChange={e => setRawPageSearch(e.target.value)}
                  className="w-full h-8 rounded border border-border bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                />
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-4 px-4 py-2 border-b border-border shrink-0 text-xs text-muted-foreground">
                <span>
                  Total chars:{' '}
                  <span className="font-mono text-foreground">
                    {rawParse.pages.reduce((a, p) => a + p.char_count, 0).toLocaleString()}
                  </span>
                </span>
                <span>
                  Total words:{' '}
                  <span className="font-mono text-foreground">
                    {rawParse.pages.reduce((a, p) => a + p.word_count, 0).toLocaleString()}
                  </span>
                </span>
                <span>
                  Avg words/page:{' '}
                  <span className="font-mono text-foreground">
                    {rawParse.total_pages > 0
                      ? Math.round(rawParse.pages.reduce((a, p) => a + p.word_count, 0) / rawParse.total_pages)
                      : 0}
                  </span>
                </span>
              </div>

              {/* Pages */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {rawParse.pages
                  .filter(p =>
                    rawPageSearch === '' ||
                    p.text.toLowerCase().includes(rawPageSearch.toLowerCase()) ||
                    (p.title ?? '').toLowerCase().includes(rawPageSearch.toLowerCase())
                  )
                  .map(page => (
                    <Card key={page.page_num} className="overflow-hidden">
                      {/* Page header */}
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border">
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono shrink-0">
                          p.{page.page_num}
                        </Badge>
                        {page.title && (
                          <span className="text-xs font-medium truncate flex-1">{page.title}</span>
                        )}
                        {!page.title && (
                          <span className="text-xs text-muted-foreground italic flex-1">No title detected</span>
                        )}
                        <div className="flex items-center gap-2 shrink-0 text-[10px] text-muted-foreground">
                          <span>{page.word_count.toLocaleString()} words</span>
                          <span>{page.char_count.toLocaleString()} chars</span>
                          {page.word_count === 0 && (
                            <Badge className="text-[10px] h-4 px-1 bg-yellow-500/15 text-yellow-400 border-yellow-500/20 border">
                              empty
                            </Badge>
                          )}
                        </div>
                      </div>
                      {/* Raw text */}
                      <pre
                        className={cn(
                          'text-[11px] font-mono whitespace-pre-wrap break-words p-3 leading-relaxed',
                          page.word_count === 0 ? 'text-muted-foreground italic' : 'text-foreground'
                        )}
                      >
                        {page.text || '(no text extracted)'}
                      </pre>
                    </Card>
                  ))}
                {rawParse.pages.filter(p =>
                  rawPageSearch === '' ||
                  p.text.toLowerCase().includes(rawPageSearch.toLowerCase()) ||
                  (p.title ?? '').toLowerCase().includes(rawPageSearch.toLowerCase())
                ).length === 0 && (
                  <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                    No pages match &ldquo;{rawPageSearch}&rdquo;
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
