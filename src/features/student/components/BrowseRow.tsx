import { motion } from 'framer-motion';
import { BookOpen } from 'lucide-react';
import { ConsoleTile, SectionHeader } from '@/components/console';
import { topicIcon } from '@/lib/topicIcon';
import type { Row } from '@/features/student/homeFeed';

interface BrowseRowProps {
  row: Row;
  onOpen: (id: string) => void;
}

/**
 * A Netflix-style horizontal rail of cover-art tiles for one section (Continue,
 * or a single course). Tiles lift on hover; the row scrolls horizontally and
 * bleeds off the right edge to imply more content.
 */
export function BrowseRow({ row, onOpen }: BrowseRowProps) {
  if (row.items.length === 0) return null;
  return (
    <section className="space-y-5">
      <SectionHeader icon={BookOpen} eyebrow={row.eyebrow} title={row.title} />
      <div
        className="-mr-6 flex gap-4 overflow-x-auto pb-2 pr-6 lg:-mr-12 lg:pr-12 scrollbar-hide snap-x"
        style={{ scrollbarWidth: 'none' }}
      >
        {row.items.map((v, i) => {
          const LectureIcon = topicIcon(v.cleanTitle, v.lecture.id);
          return (
          <motion.button
            key={v.lecture.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 8) * 0.04 }}
            onClick={() => onOpen(v.lecture.id)}
            className="console-focusable snap-start shrink-0 origin-bottom rounded-2xl outline-none transition-transform duration-300 hover:-translate-y-1.5"
            style={{ width: 180, height: 248 }}
            aria-label={`${v.cleanTitle}. ${v.pct}% complete.`}
          >
            <ConsoleTile
              isActive={false}
              gradientIndex={i}
              title={v.cleanTitle}
              progress={v.pct}
              watermark={v.badge ?? <LectureIcon className="h-14 w-14 text-white/15" />}
              badge={v.status === 'done' ? { kind: 'done', label: 'Done' } : undefined}
            />
          </motion.button>
          );
        })}
      </div>
    </section>
  );
}
