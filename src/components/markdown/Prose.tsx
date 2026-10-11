import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

/**
 * Parsed text, typeset.
 *
 * The pipeline writes each page's text as Markdown into `slides.content_text`
 * and the old product renders it three separate times with three separate
 * class strings (`LectureView`, `InlineLecturePlayer`, `SlideViewer`). This is
 * the one renderer: same plugins — tables, task lists, maths through KaTeX —
 * and the type set once, here, as element mappings rather than a `prose-*`
 * utility string nobody can read.
 *
 * Sized for an hour. The `reading` variant is 18px on a 1.7 line, which is
 * the measure a long text on a dark ground needs; `compact` is for the same
 * Markdown inside a card or a reply, where it is one paragraph among others.
 *
 * No colours of its own beyond the ink scale. The accent — a heading's
 * hairline, a link — comes from `--reader-accent` on an ancestor, which the
 * page it sits beside sets. So the text is lit by the same colour as the
 * source it was parsed from.
 */

export type ProseVariant = 'reading' | 'compact';

const READING: Components = {
  h1: ({ children }) => (
    <h3 className="mb-3 mt-8 text-[22px] font-semibold leading-[1.25] tracking-[-0.01em] text-white/[0.92] first:mt-0">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h3 className="mb-3 mt-8 text-[22px] font-semibold leading-[1.25] tracking-[-0.01em] text-white/[0.92] first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-6 text-[18px] font-semibold leading-[1.4] text-white/[0.92] first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mb-[1.7em] text-[18px] leading-[1.7] text-white/[0.92] last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-[1.7em] list-none space-y-[0.45em] pl-0 text-[18px] leading-[1.7] text-white/[0.92] last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-[1.7em] list-decimal space-y-[0.45em] pl-6 text-[18px] leading-[1.7] text-white/[0.92] marker:text-[color:var(--reader-accent,theme(colors.secondary.DEFAULT))] last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="relative pl-6 before:absolute before:left-0 before:top-[0.85em] before:h-px before:w-3 before:bg-[color:var(--reader-accent,theme(colors.secondary.DEFAULT))] before:content-['']">
      {children}
    </li>
  ),
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-white/[0.80]">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      className="console-focusable rounded-sm text-[color:var(--reader-accent,theme(colors.secondary.DEFAULT))] underline decoration-1 underline-offset-[3px]"
    >
      {children}
    </a>
  ),
  code: ({ children, className }) =>
    className?.includes('language-') ? (
      <code className="block overflow-x-auto rounded-md border border-white/[0.08] bg-black/40 p-4 text-[15.5px] leading-[1.6] text-white/[0.92]">
        {children}
      </code>
    ) : (
      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[0.86em] text-white/[0.92]">
        {children}
      </code>
    ),
  pre: ({ children }) => <pre className="mb-[1.7em] last:mb-0">{children}</pre>,
  blockquote: ({ children }) => (
    <blockquote className="mb-[1.7em] border-l border-[color:var(--reader-accent,theme(colors.secondary.DEFAULT))] pl-5 text-white/[0.72] last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-[1.7em] border-white/[0.08]" />,
  table: ({ children }) => (
    <div className="mb-[1.7em] overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-[15.5px] leading-[1.5] text-white/[0.92]">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-white/[0.14] px-3 py-2 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-white/[0.06] px-3 py-2 align-top">{children}</td>,
  img: ({ src, alt }) => (
    <img src={src} alt={alt ?? ''} className="my-[1.7em] max-w-full rounded-md border border-white/[0.08]" />
  ),
};

const COMPACT: Components = {
  ...READING,
  h1: ({ children }) => <h4 className="mb-1.5 mt-4 text-[15px] font-semibold text-white/[0.92] first:mt-0">{children}</h4>,
  h2: ({ children }) => <h4 className="mb-1.5 mt-4 text-[15px] font-semibold text-white/[0.92] first:mt-0">{children}</h4>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-4 text-[14px] font-semibold text-white/[0.92] first:mt-0">{children}</h4>,
  p: ({ children }) => (
    <p className="mb-3 text-[14px] leading-[1.65] text-white/[0.92] last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-none space-y-1 pl-0 text-[14px] leading-[1.65] text-white/[0.92] last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 text-[14px] leading-[1.65] text-white/[0.92] last:mb-0">
      {children}
    </ol>
  ),
};

interface Props {
  children: string;
  variant?: ProseVariant;
  className?: string;
}

export function Prose({ children, variant = 'reading', className }: Props) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={variant === 'reading' ? READING : COMPACT}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
