import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Trash2, ArchiveRestore, Loader2, Search, ArrowLeft,
  AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth';
import {
  listCourses,
  updateCourse,
  deleteCourse,
  type Course
} from '@/services/coursesService';
import {
  fetchProfessorLectures,
  unarchiveLecture,
  deleteLecture
} from '@/services/lectureService';
import type { Lecture } from '@/types/domain';
import { splitLectureTitle } from '@/lib/utils';

/* ── Swatches matching ProfessorCourses ── */
const COLOR_SWATCHES = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f59e0b', '#10b981', '#06b6d4', '#3b82f6',
];

export default function ProfessorArchive() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'courses' | 'lectures'>('courses');
  const [courses, setCourses] = useState<Course[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const loadArchive = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [coursesData, lecturesData] = await Promise.all([
        listCourses({ onlyArchived: true }),
        fetchProfessorLectures(user.id, { onlyArchived: true })
      ]);
      setCourses(coursesData);
      setLectures(lecturesData);
    } catch (e) {
      console.error('Failed to load archive:', e);
      toast({
        title: 'Error loading archive',
        description: 'We could not fetch your archived items. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadArchive();
  }, [user]);

  const handleRestoreCourse = async (c: Course) => {
    setActionInProgress(c.id);
    try {
      await updateCourse(c.id, { is_archived: false });
      toast({
        title: 'Course restored',
        description: `"${c.title}" is now active and visible on dashboards.`
      });
      setCourses(prev => prev.filter(item => item.id !== c.id));
    } catch (e) {
      console.error(e);
      toast({
        title: 'Failed to restore course',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeleteCourse = async (c: Course) => {
    if (c.lecture_count > 0) {
      toast({
        title: 'Course is not empty',
        description: 'Archived courses containing lectures cannot be deleted permanently. Delete or reassign lectures first.',
        variant: 'destructive'
      });
      return;
    }
    if (!confirm(`Permanently delete the course "${c.title}"? This action is irreversible.`)) return;
    setActionInProgress(c.id);
    try {
      await deleteCourse(c.id);
      toast({
        title: 'Course deleted permanently',
        description: `"${c.title}" was purged from the archive.`
      });
      setCourses(prev => prev.filter(item => item.id !== c.id));
    } catch (e) {
      console.error(e);
      toast({
        title: 'Failed to delete course',
        description: 'An error occurred during course removal.',
        variant: 'destructive'
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRestoreLecture = async (l: Lecture) => {
    setActionInProgress(l.id);
    try {
      await unarchiveLecture(l.id);
      toast({
        title: 'Lecture restored',
        description: `"${l.title}" is now active and visible to students.`
      });
      setLectures(prev => prev.filter(item => item.id !== l.id));
    } catch (e) {
      console.error(e);
      toast({
        title: 'Failed to restore lecture',
        description: 'An unexpected error occurred.',
        variant: 'destructive'
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeleteLecture = async (l: Lecture) => {
    if (!confirm(`Permanently delete the lecture "${l.title}"? This will purge all associated slides, quizzes, and student progress metrics. This action is irreversible.`)) return;
    setActionInProgress(l.id);
    try {
      await deleteLecture(l.id);
      toast({
        title: 'Lecture deleted permanently',
        description: `"${l.title}" has been purged.`
      });
      setLectures(prev => prev.filter(item => item.id !== l.id));
    } catch (e) {
      console.error(e);
      toast({
        title: 'Failed to delete lecture',
        description: 'An error occurred during lecture removal.',
        variant: 'destructive'
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const filteredCourses = courses.filter(c => 
    c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredLectures = lectures.filter(l => 
    l.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (l.description && l.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="relative min-h-screen p-6 lg:p-10 max-w-[1600px] mx-auto space-y-8 bg-background">
      
      {/* ── Orbital Background for premium look ── */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div
          className="absolute top-[10%] left-[20%] w-[40%] h-[40%] rounded-full"
          style={{
            background: 'radial-gradient(circle, hsl(263 70% 50% / 0.04) 0%, transparent 70%)',
            filter: 'blur(100px)',
          }}
        />
        <div
          className="absolute bottom-[10%] right-[10%] w-[35%] h-[35%] rounded-full"
          style={{
            background: 'radial-gradient(circle, hsl(180 70% 50% / 0.03) 0%, transparent 70%)',
            filter: 'blur(90px)',
          }}
        />
      </div>

      <div className="relative z-10 space-y-8">
        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <button 
              onClick={() => navigate('/professor/dashboard')}
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors group mb-2"
            >
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
              Back to Dashboard
            </button>
            <h1 className="text-4xl font-black text-foreground tracking-tight flex items-center gap-3">
              Documentation Archive
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl font-medium">
              Browse archived courses and lectures. These items are hidden from production dashboards to keep active semesters clean, but all data, slides, and quizzes remain intact here.
            </p>
          </div>
        </div>

        {/* ── Search & Tab Bar ── */}
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between p-4 glass-panel border-white/5 rounded-2xl shadow-xl">
          <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/5 w-full md:w-auto">
            <button
              onClick={() => setActiveTab('courses')}
              className={`flex-1 md:flex-none px-6 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-300 ${
                activeTab === 'courses'
                  ? 'bg-primary text-primary-foreground shadow-glow-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}
            >
              Courses ({courses.length})
            </button>
            <button
              onClick={() => setActiveTab('lectures')}
              className={`flex-1 md:flex-none px-6 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-300 ${
                activeTab === 'lectures'
                  ? 'bg-primary text-primary-foreground shadow-glow-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}
            >
              Lectures ({lectures.length})
            </button>
          </div>

          <div className="relative w-full md:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={`Search archived ${activeTab}...`}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-11 h-11 bg-white/5 border-white/5 rounded-xl text-sm focus:border-primary/50 placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* ── Loader ── */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 space-y-4">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <p className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground animate-pulse">Loading archive...</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {activeTab === 'courses' ? (
              <motion.div
                key="courses-grid"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.4 }}
              >
                {filteredCourses.length === 0 ? (
                  <div className="glass-panel p-20 text-center rounded-[2rem] border-white/5 border-dashed border-2">
                    <AlertCircle className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4 animate-pulse" />
                    <h3 className="text-lg font-bold text-foreground mb-1">No archived courses found</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      {searchQuery ? 'Adjust your search filters to find archived subjects.' : 'Archived courses will appear here once you select "Archive" on the courses directory.'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredCourses.map(c => (
                      <motion.div
                        key={c.id}
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="glass-panel border-white/5 hover:border-primary/20 transition-all rounded-[24px] p-6 space-y-4 flex flex-col justify-between group relative overflow-hidden shadow-lg hover:shadow-2xl"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-12 h-12 rounded-xl flex items-center justify-center shadow-md flex-shrink-0"
                                style={{ background: c.color || COLOR_SWATCHES[0] }}
                              >
                                <BookOpen className="w-6 h-6 text-white" />
                              </div>
                              <div>
                                <h3 className="font-bold text-foreground tracking-tight text-lg group-hover:text-primary transition-colors">{c.title}</h3>
                                <p className="text-xs text-muted-foreground font-semibold">
                                  {c.lecture_count} archived lecture{c.lecture_count === 1 ? '' : 's'}
                                </p>
                              </div>
                            </div>
                          </div>
                          {c.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed font-medium">
                              {c.description}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 pt-4 border-t border-white/5 mt-auto">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={actionInProgress !== null}
                            onClick={() => void handleRestoreCourse(c)}
                            className="gap-2 text-xs font-bold hover:bg-primary/10 hover:text-primary transition-all rounded-lg"
                          >
                            {actionInProgress === c.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <ArchiveRestore className="w-3.5 h-3.5" />
                            )}
                            Restore to Active
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={actionInProgress !== null}
                            onClick={() => void handleDeleteCourse(c)}
                            className="gap-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive transition-all rounded-lg ml-auto"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete Purge
                          </Button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="lectures-list"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.4 }}
              >
                {filteredLectures.length === 0 ? (
                  <div className="glass-panel p-20 text-center rounded-[2rem] border-white/5 border-dashed border-2">
                    <AlertCircle className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4 animate-pulse" />
                    <h3 className="text-lg font-bold text-foreground mb-1">No archived lectures found</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      {searchQuery ? 'Adjust your search filters to find archived slide decks.' : 'Archived lectures will appear here once you select "Archive" on the lecture control deck.'}
                    </p>
                  </div>
                ) : (
                  <div className="glass-panel rounded-3xl border-white/5 overflow-hidden shadow-2xl bg-white/[0.01]">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-white/5 bg-white/5">
                            <th className="px-8 py-5 text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Lecture Title</th>
                            <th className="px-8 py-5 text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Slides</th>
                            <th className="px-8 py-5 text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Creation Date</th>
                            <th className="px-8 py-5 text-right text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Operations</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {filteredLectures.map((lecture, idx) => (
                            <motion.tr
                              key={lecture.id}
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.03 }}
                              className="hover:bg-white/5 transition-all group"
                            >
                              <td className="px-8 py-5">
                                <div className="flex items-center gap-3">
                                  {(() => {
                                    const { badge, cleanTitle } = splitLectureTitle(lecture.title);
                                    return (
                                      <>
                                        {badge ? (
                                          <div className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg bg-primary/10 text-primary transition-colors">
                                            {badge}
                                          </div>
                                        ) : (
                                          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                                            <BookOpen className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                                          </div>
                                        )}
                                        <div>
                                          <p className="font-bold text-foreground tracking-tight text-base">{cleanTitle}</p>
                                          {lecture.description && (
                                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{lecture.description}</p>
                                          )}
                                        </div>
                                      </>
                                    );
                                  })()}
                                </div>
                              </td>
                              <td className="px-8 py-5 font-bold text-foreground/80">{lecture.total_slides}</td>
                              <td className="px-8 py-5 text-sm text-muted-foreground font-medium">
                                {new Date(lecture.created_at).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric'
                                })}
                              </td>
                              <td className="px-8 py-5 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={actionInProgress !== null}
                                    onClick={() => void handleRestoreLecture(lecture)}
                                    className="gap-2 text-xs font-bold hover:bg-primary/10 hover:text-primary transition-all rounded-lg"
                                  >
                                    {actionInProgress === lecture.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <ArchiveRestore className="w-3.5 h-3.5" />
                                    )}
                                    Restore
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={actionInProgress !== null}
                                    onClick={() => void handleDeleteLecture(lecture)}
                                    className="gap-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive transition-all rounded-lg"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Purge
                                  </Button>
                                </div>
                              </td>
                            </motion.tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
