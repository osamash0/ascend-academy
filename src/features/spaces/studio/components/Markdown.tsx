import { memo } from 'react';
import { Streamdown, defaultRehypePlugins } from 'streamdown';
import { cn } from '@/lib/utils';

/**
 * Streamdown's defaults include rehype-raw, which parses raw HTML out of the
 * text. Material text and model output are untrusted, so raw HTML is dropped
 * (the remark side then keeps it as plain text) and only sanitize + harden stay.
 */
const REHYPE_PLUGINS = [defaultRehypePlugins.sanitize, defaultRehypePlugins.harden];
/**
 * Images are off: a remote image is a fetch to someone else's server, a way
 * to leak what the student is reading. The Material's own pages are shown by
 * the Peek and the original view, never through Markdown.
 */
const NO_ELEMENTS = ['img'];

/**
 * The one renderer (spec §3.4). The clean page, AI answers and created items
 * all go through it, so the Material and the assistant read as one surface.
 */
export const Markdown = memo(function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <Streamdown
      className={cn('studio-prose', className)}
      rehypePlugins={REHYPE_PLUGINS}
      disallowedElements={NO_ELEMENTS}
    >
      {children}
    </Streamdown>
  );
});
