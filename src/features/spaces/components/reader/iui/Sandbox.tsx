import { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, RotateCcw, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ExplainBlock } from './spec';

/**
 * A small app the model wrote for this question, run where it cannot hurt.
 *
 * The isolation is the browser's, not ours to argue with:
 * - `sandbox="allow-scripts"` and nothing else — no same-origin, so the app
 *   has an opaque origin: no cookies, no storage, no session, no reaching
 *   into this page; no forms, popups, top navigation or downloads either;
 * - a CSP of `default-src 'none'` inside it — no network at all, no external
 *   scripts, styles, fonts or images; only its own inline code;
 * - one way out, `postMessage`, of which this component accepts exactly two
 *   shapes from exactly that frame: its height, and a follow-up question
 *   (`LS.ask`), length-capped, which the reader treats like a typed one.
 *
 * The server has already refused apps that reach for any of that; this is
 * the part that holds even if it had not. The page is pre-styled with the
 * reader's tokens, so a generated app looks like it belongs here.
 */

type SandboxSpec = Extract<ExplainBlock, { type: 'sandbox' }>;

const MIN_H = 160;
const MAX_H = 720;

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

/** The design system the app is drawn in — the reader's own tokens, as CSS. */
const BASE_CSS = `
:root{--bg:#0b0b0c;--card:rgba(255,255,255,.04);--line:rgba(255,255,255,.09);--text:#f4f4f5;--quiet:#a1a1aa;
--accent:ACCENT;--good:#34d399;--bad:#f87171;color-scheme:dark}
*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--text);
font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
body{padding:2px}#ls-root{display:flex;flex-direction:column;gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.muted{color:var(--quiet)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.btn{appearance:none;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--text);
height:32px;padding:0 14px;border-radius:999px;font:inherit;font-size:13px;cursor:pointer}
.btn:hover{background:rgba(255,255,255,.11)}.btn.primary{background:var(--text);color:#0b0b0c;border-color:transparent}
.btn:disabled{opacity:.4;cursor:default}
.chip{display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:999px;background:rgba(255,255,255,.06);
color:var(--quiet);font-size:12.5px;border:0;cursor:pointer}.chip.on{background:rgba(255,255,255,.18);color:var(--text)}
input,select,textarea{background:rgba(255,255,255,.05);border:1px solid var(--line);color:var(--text);border-radius:10px;
height:32px;padding:0 10px;font:inherit}textarea{height:auto;padding:8px 10px}
input[type=range]{accent-color:var(--accent);height:auto;padding:0;border:0;background:none}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
svg text{fill:var(--text);font-family:inherit}table{border-collapse:collapse}td,th{border-bottom:1px solid var(--line);padding:6px 10px;text-align:left}
`;

/** The app's side of the bridge: report height, ask a follow-up, report a crash. */
const RUNTIME = `
(function(){
  var post=function(m){try{parent.postMessage(m,'*')}catch(e){}};
  window.LS={ask:function(t){post({ls:'ask',text:String(t||'').slice(0,300)})}};
  /* The app's own height, not the document's: the document is never shorter than the frame, so measuring it could only ever grow. */
  var last=0;var root=function(){return document.getElementById('ls-root')};
  var size=function(){var r=root();if(!r)return;var h=Math.ceil(r.getBoundingClientRect().height+8);if(Math.abs(h-last)>2){last=h;post({ls:'height',h:h})}};
  var watch=function(){var r=root();if(r){new ResizeObserver(size).observe(r);size()}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watch);else watch();window.addEventListener('load',size);
  window.addEventListener('error',function(e){post({ls:'error',message:String(e.message||'error').slice(0,200)})});
})();`;

/** Text placed inside a <script> must not be able to close it. */
const scriptSafe = (s: string) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

export function buildSrcDoc(spec: Pick<SandboxSpec, 'html' | 'css' | 'js'>, accent: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    `<style>${BASE_CSS.replace('ACCENT', accent.replace(/[;{}<>]/g, ''))}</style>`,
    `<style>${spec.css.replace(/<\/style/gi, '')}</style>`,
    '</head><body><div id="ls-root">',
    spec.html,
    '</div>',
    `<script>${RUNTIME}</script>`,
    `<script>try{${scriptSafe(spec.js)}\n}catch(e){parent.postMessage({ls:'error',message:String(e&&e.message||e).slice(0,200)},'*')}</script>`,
    '</body></html>',
  ].join('');
}

export function SandboxBlock({ block, onAsk }: { block: SandboxSpec; onAsk?: (question: string) => void }) {
  const { t } = useTranslation('v4Reader');
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(Math.min(MAX_H, Math.max(MIN_H, block.height ?? 380)));
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(false);
  const [run, setRun] = useState(0);
  /* The deck's accent lives on the reader's root, so read it from where this sits. */
  const shell = useRef<HTMLDivElement>(null);
  const [accent, setAccent] = useState<string | null>(null);
  useEffect(() => {
    const v = shell.current ? getComputedStyle(shell.current).getPropertyValue('--reader-accent').trim() : '';
    setAccent(v || '#60a5fa');
  }, []);
  const srcDoc = useMemo(() => (accent ? buildSrcDoc(block, accent) : ''), [block, accent]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only this frame, only these shapes.
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as { ls?: unknown; h?: unknown; text?: unknown; message?: unknown };
      if (!m || typeof m !== 'object') return;
      if (m.ls === 'height' && typeof m.h === 'number' && Number.isFinite(m.h)) {
        setHeight(Math.min(MAX_H, Math.max(MIN_H, Math.round(m.h) + 4)));
      } else if (m.ls === 'ask' && typeof m.text === 'string' && m.text.trim().length > 1) {
        onAsk?.(m.text.trim().slice(0, 300));
      } else if (m.ls === 'error' && typeof m.message === 'string') {
        setError(m.message.slice(0, 200));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onAsk]);

  return (
    <div ref={shell} className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-foreground">{block.title}</p>
          {block.caption && <p className="mt-0.5 text-[13px] leading-[1.45] text-quiet">{block.caption}</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setRun((n) => n + 1);
          }}
          className="console-focusable flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          {t('blocks.sandbox.restart')}
        </button>
      </div>
      <div className="px-3">
        {srcDoc && <iframe
          key={run}
          ref={frame}
          title={block.title}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="block w-full rounded-xl bg-transparent"
          style={{ height, border: 0 }}
        />}
      </div>
      {error && (
        <p role="alert" className="mx-5 mt-2 text-[12.5px] text-destructive">
          {t('blocks.sandbox.error', { error })}
        </p>
      )}
      <div className="flex items-center gap-3 px-5 py-3">
        <span className="flex items-center gap-1.5 text-[12px] text-faint">
          <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
          {t('blocks.sandbox.note')}
        </span>
        <button
          type="button"
          aria-expanded={code}
          onClick={() => setCode((c) => !c)}
          className="console-focusable ml-auto flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <Code2 aria-hidden className="h-3.5 w-3.5" />
          {code ? t('blocks.sandbox.hideCode') : t('blocks.sandbox.viewCode')}
        </button>
      </div>
      {code && (
        <pre className={cn('max-h-80 overflow-auto border-t border-white/[0.06] bg-black/40 p-4 text-[12px] leading-[1.5] text-quiet')}>
          <code>{`<!-- html -->\n${block.html}\n\n/* css */\n${block.css}\n\n// js\n${block.js}`}</code>
        </pre>
      )}
    </div>
  );
}
