/**
 * Ask Luna — the contract between the tutor model and the UI.
 *
 * A Luna turn is a list of parts: short text, or a *widget* picked from a
 * curated registry by name with typed props. The model never ships code or
 * HTML; it chooses a component and fills in a scenario. Props are validated
 * here, and anything malformed degrades to plain text instead of rendering.
 *
 * Crucially, widgets compute their own answers from the props (e.g. the JOIN
 * playground runs the join itself). The model picks *what to practise*; it is
 * never trusted to say *what is correct*. A hallucinated answer key can't
 * teach a student something false.
 *
 * Research behind the shape: curated registries over open-ended generated UI
 * (CopilotKit's static/declarative patterns, ChatGPT's ~70 curated study
 * modules), and hint-first tutoring (Bastani et al., PNAS 2025: unrestricted
 * GPT-4 lowered exam scores 17%, a hint-only tutor did not).
 */
import { z } from 'zod';

const cell = z.union([z.string(), z.number(), z.null()]);

const table = z.object({
  name: z.string().min(1).max(40),
  columns: z.array(z.string().min(1).max(30)).min(1).max(5),
  rows: z.array(z.array(cell)).min(1).max(6),
});

export const joinPlaygroundProps = z
  .object({
    joinType: z.enum(['INNER', 'LEFT', 'RIGHT', 'FULL']),
    left: table,
    right: table,
    on: z.object({ left: z.string(), right: z.string() }),
    prompt: z.string().max(200).optional(),
  })
  .refine((p) => p.left.columns.includes(p.on.left) && p.right.columns.includes(p.on.right), 'join columns must exist')
  .refine((p) => [p.left, p.right].every((t) => t.rows.every((r) => r.length === t.columns.length)), 'ragged rows');

export const conceptCheckProps = z
  .object({
    question: z.string().min(5).max(240),
    options: z
      .array(z.object({ text: z.string().min(1).max(160), correct: z.boolean(), why: z.string().max(240) }))
      .min(2)
      .max(5),
    hint: z.string().max(240),
  })
  .refine((p) => p.options.filter((o) => o.correct).length === 1, 'exactly one correct option');

export const WIDGET_SCHEMAS = {
  JoinPlayground: joinPlaygroundProps,
  ConceptCheck: conceptCheckProps,
} as const;

export type WidgetName = keyof typeof WIDGET_SCHEMAS;
export type JoinPlaygroundProps = z.infer<typeof joinPlaygroundProps>;
export type ConceptCheckProps = z.infer<typeof conceptCheckProps>;

export type LunaPart =
  | { type: 'text'; text: string }
  | { type: 'widget'; component: 'JoinPlayground'; props: JoinPlaygroundProps }
  | { type: 'widget'; component: 'ConceptCheck'; props: ConceptCheckProps };

/** What a widget reports back, so Luna can react (and, later, so the tutor sees the attempt). */
export type WidgetOutcome = 'correct' | 'hint' | 'revealed';

/**
 * Validate a raw model turn. Unknown components and invalid props become a
 * gentle text fallback — the chat never shows a broken widget.
 */
export function parseTurn(raw: unknown, fallback: string): LunaPart[] {
  const parts = (raw as { parts?: unknown })?.parts;
  if (!Array.isArray(parts)) return [{ type: 'text', text: fallback }];
  const out: LunaPart[] = [];
  for (const p of parts) {
    if (p?.type === 'text' && typeof p.text === 'string' && p.text.trim()) {
      out.push({ type: 'text', text: p.text.slice(0, 1200) });
    } else if (p?.type === 'widget' && p.component in WIDGET_SCHEMAS) {
      const name = p.component as WidgetName;
      const parsed = WIDGET_SCHEMAS[name].safeParse(p.props);
      if (parsed.success) out.push({ type: 'widget', component: name, props: parsed.data } as LunaPart);
      else out.push({ type: 'text', text: fallback });
    }
  }
  return out.length ? out : [{ type: 'text', text: fallback }];
}
