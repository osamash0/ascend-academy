import { memo } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';

/**
 * The one renderer (spec §3.4). The clean page, AI answers and created items
 * all go through it, so the Material and the assistant read as one surface.
 * Streamdown sanitises and hardens by default; nothing here turns that off.
 */
export const Markdown = memo(function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return <Streamdown className={cn('studio-prose', className)}>{children}</Streamdown>;
});
