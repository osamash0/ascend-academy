import { motion, AnimatePresence } from 'framer-motion';
import { LaunchButton } from '@/components/console';
import { splitLectureTitle } from '@/lib/utils';
import type { Lecture } from '@/types/domain';
import type { Course } from '@/services/coursesService';
import { Settings, Eye, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProfessorHeroStageProps {
  lecture: Lecture;
  /** "Good morning · Prof. Smith" style line. */
  eyebrow: string;
  courses: Course[];
  onAssignCourse: (courseId: string | null) => void;
  onAnalytics: () => void;
  onEdit: () => void;
  onPreview: () => void;
  onDelete: () => void;
}

/**
 * The cinematic lower-third hero for professors: greeting eyebrow, big lecture title, 
 * slide count metadata, and primary action buttons. Cross-fades when the
 * focused lecture changes. Driven by the MediaRail position in the dashboard.
 */
export function ProfessorHeroStage({ lecture, eyebrow, courses, onAssignCourse, onAnalytics, onEdit, onPreview, onDelete }: ProfessorHeroStageProps) {
  const { cleanTitle } = splitLectureTitle(lecture.title);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={lecture.id}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
        className="max-w-3xl space-y-5"
      >
        <span className="text-[11px] font-black uppercase tracking-[0.3em] text-white/60">{eyebrow}</span>
        <h1 className="text-5xl lg:text-7xl font-black tracking-tight leading-[0.9] drop-shadow-[0_2px_20px_rgba(0,0,0,0.6)] text-white">
          {cleanTitle}
        </h1>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className={`inline-flex items-center gap-2 text-xs font-black px-3 py-1 rounded-full uppercase tracking-widest border transition-all ${lecture.pdf_url 
            ? 'bg-success/10 text-success border-success/20 shadow-glow-success/5' 
            : 'bg-warning/10 text-warning border-warning/20'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${lecture.pdf_url ? 'bg-success animate-pulse' : 'bg-warning'}`} />
            {lecture.pdf_url ? 'Active Protocol' : 'No Source PDF'}
          </span>
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/70">
            Slides {lecture.total_slides}
          </span>
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/70">
            Created {new Date(lecture.created_at).toLocaleDateString()}
          </span>
          
          <div className="flex items-center gap-2 bg-white/5 rounded-full px-3 py-1 border border-white/10">
            <span className="text-[10px] font-black uppercase tracking-widest text-white/50">Course</span>
            <select
              value={lecture.course_id ?? ''}
              onChange={(e) => onAssignCourse(e.target.value || null)}
              className="bg-transparent border-none text-xs font-bold text-white/90 focus:outline-none focus:ring-0 cursor-pointer appearance-none pr-4"
            >
              <option value="" className="bg-black text-white">Uncategorized</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id} className="bg-black text-white">{c.title}</option>
              ))}
            </select>
          </div>
        </div>
        {lecture.description && (
          <p className="text-sm text-white/70 line-clamp-2 max-w-2xl leading-relaxed">
            {lecture.description}
          </p>
        )}
        <div className="pt-2 flex flex-wrap items-center gap-4">
          <LaunchButton label="View Analytics" onClick={onAnalytics} />
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full w-12 h-12 bg-white/5 hover:bg-white/15 text-white shadow-sm border border-white/10 hover:border-white/20 transition-all"
              onClick={onPreview}
              title="Preview Lecture"
            >
              <Eye className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full w-12 h-12 bg-white/5 hover:bg-white/15 text-white shadow-sm border border-white/10 hover:border-white/20 transition-all"
              onClick={onEdit}
              title="Edit Lecture"
            >
              <Settings className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full w-12 h-12 bg-destructive/10 hover:bg-destructive/20 text-destructive shadow-sm border border-destructive/20 hover:border-destructive/30 transition-all"
              onClick={onDelete}
              title="Delete Lecture"
            >
              <Trash2 className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
