import { useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { boxStyle, unionBox, unmappedSourceBlocks } from '../geometry';
import { FLIGHT_EASE, FLIGHT_S, STAGGER_S, TEXT_FADE_S } from '../motion';
import { firstWords, plainText } from '../text';
import type { Box, CanvasBlock, ExtractedBlock, SourcePage } from '../types';
import { PageDivider } from './PageDivider';

interface Props {
  page: SourcePage;
  /** This page's canvas blocks. */
  blocks: CanvasBlock[];
  /**
   * The anchor page: its overlays carry layoutIds, so its paragraphs fly.
   * The overlays are keyed by this flag — Motion registers a `layoutId` only
   * at mount — and the screen commits it before the view changes, so the
   * overlays that leave (Original → Clean) already carry their ids.
   */
  morph: boolean;
  materialName: string;
  onRegion(blockId: string): void;
  onInclude(sourceBlockId: string): void;
}

/** Where blocks without coordinates converge before fading (spec §4.2 rule 10). */
const CENTER: Box = [0.4, 0.45, 0.6, 0.55];
/** The reader's page on black: a hairline ring and a long, soft shadow. */
const PAGE_SHADOW =
  'shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_2px_6px_rgba(0,0,0,0.3),0_28px_64px_-16px_rgba(0,0,0,0.65)]';
/** Chrome laid over the paper: dark glass, legible on any page in either theme. */
const PILL =
  'whitespace-nowrap rounded-full border border-white/15 bg-black/70 px-2.5 text-[11px] text-white backdrop-blur-sm transition-colors';
const flight = (i: number) => ({ layout: { duration: FLIGHT_S, ease: FLIGHT_EASE, delay: i * STAGGER_S } });

/**
 * One page of the Material as it really is — spec §4.2.
 *
 * Every paragraph of your version is a button over the spot it came from
 * (click → back to that paragraph). Source blocks your version doesn't
 * contain get a dashed outline: Morph shows what got lost, not only where
 * things came from.
 */
export function OriginalPage({ page, blocks, morph, materialName, onRegion, onInclude }: Props) {
  const [offer, setOffer] = useState<string | null>(null);
  const mapped = blocks.filter((b): b is ExtractedBlock => b.origin === 'extracted');
  const missing = unmappedSourceBlocks(page, blocks);
  // Figures can't be added as text in v1: a faint outline plus one page summary, no per-figure label.
  const isFigure = (s: SourcePage['blocks'][number]) => s.kind === 'figure' || !s.text;
  const figures = missing.filter(isFigure);
  const texts = missing.filter((s) => !isFigure(s));

  return (
    <section
      data-view="original"
      data-page-anchor={page.page}
      aria-label={`Source page ${page.page}`}
      className="scroll-mt-40 lg:scroll-mt-28"
    >
      <PageDivider page={page.page} original />
      <div
        className={cn('relative overflow-hidden rounded-xl bg-[hsl(var(--studio-paper))]', PAGE_SHADOW)}
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
      >
        <img
          src={page.imageUrl}
          alt={`Page ${page.page} of ${materialName}`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-contain"
        />

        {mapped.map((b, i) => {
          const box = unionBox(
            b.source.blockIds
              .map((id) => page.blocks.find((s) => s.id === id)?.bbox)
              .filter((x): x is Box => !!x),
          );
          if (!box) {
            return morph ? (
              <motion.div
                key={`${b.id}:converge`}
                aria-hidden
                data-morph="true"
                layoutId={`morph-${b.id}`}
                transition={flight(i)}
                style={boxStyle(CENTER)}
                initial={{ opacity: 1 }}
                animate={{ opacity: 0 }}
                className="absolute"
              />
            ) : null;
          }
          // z-10: a way back stays clickable above a missing block's dashed box
          // (e.g. a callout drawn over a figure your version doesn't contain);
          // the missing blocks' pills sit higher still, at z-20.
          // The ::before pads the hit area to 24×24 without changing the box
          // the paragraph flies to.
          return (
            <motion.button
              key={`${b.id}:${morph}`}
              type="button"
              data-morph={morph ? 'true' : undefined}
              layoutId={morph ? `morph-${b.id}` : undefined}
              transition={flight(i)}
              onClick={() => onRegion(b.id)}
              aria-label={`${b.edited ? 'Back to (edited)' : 'Back to'}: ${firstWords(b.markdown)}`}
              style={boxStyle(box)}
              className="absolute z-10 rounded-[4px] outline-none before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-6 before:w-full before:min-w-6 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] hover:bg-[hsl(var(--studio-mark)/0.18)] focus-visible:ring-2 focus-visible:ring-ring"
            >
              {morph && (
                <motion.span
                  aria-hidden
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: TEXT_FADE_S }}
                  className="block overflow-hidden text-left text-[13px] leading-snug text-[#2c2c2a]"
                >
                  {plainText(b.markdown)}
                </motion.span>
              )}
              {b.edited && (
                <span className={cn(PILL, 'absolute -top-5 right-0 py-0.5 font-medium')}>
                  Edited by you
                </span>
              )}
            </motion.button>
          );
        })}

        {figures.length > 0 && (
          <span className={cn(PILL, 'pointer-events-none absolute right-2 top-2 z-20 py-0.5')}>
            {figures.length} {figures.length === 1 ? 'figure' : 'figures'} not in your version
          </span>
        )}
        {figures.map((s) => (
          <div
            key={s.id}
            aria-hidden
            style={boxStyle(s.bbox)}
            className="pointer-events-none absolute rounded-[4px] border border-dashed border-black/20"
          />
        ))}
        {texts.map((s) => (
          <div
            key={s.id}
            style={boxStyle(s.bbox)}
            className="absolute rounded-[4px] border-2 border-dashed border-black/35"
          >
            <button
              type="button"
              aria-label={`${offer === s.id ? 'Add to your version' : 'Not in your version'}: ${firstWords(s.text)}`}
              onClick={() => (offer === s.id ? onInclude(s.id) : setOffer(s.id))}
              className={cn(PILL, 'absolute -top-6 left-0 z-20 min-h-6 hover:bg-black/85')}
            >
              {offer === s.id ? 'Add to your version' : 'Not in your version'}
            </button>
          </div>
        ))}

        {page.geometry === 'page' && mapped[0] && (
          <button
            type="button"
            onClick={() => onRegion(mapped[0].id)}
            className={cn(PILL, 'absolute inset-x-0 bottom-3 mx-auto h-8 w-fit px-4 text-[12px] hover:bg-black/85')}
          >
            Back to Learn
          </button>
        )}
      </div>
    </section>
  );
}
