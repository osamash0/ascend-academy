import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Users,
  Activity,
  Database,
  AlertCircle,
  RefreshCw,
  Eye,
  EyeOff,
  Terminal,
  CheckCircle2,
  ShieldAlert,
  Cpu,
  Trash2,
  Clock,
  HardDriveDownload,
  ExternalLink,
  Info,
  Server
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { adminService, type AdminUser, type ActivityEvent, type SentryError, type BackupSession, type DeploymentTelemetry } from '@/services/adminService';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type ActiveTab = 'activity' | 'visibility' | 'errors' | 'reset' | 'deployment';

export default function AdminDashboard() {
  const { t } = useTranslation(['common']);
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ActiveTab>('activity');
  const [loading, setLoading] = useState(true);

  // Data States
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [sentryErrors, setSentryErrors] = useState<SentryError[]>([]);
  const [sentryConfig, setSentryConfig] = useState<any>(null);
  const [courses, setCourses] = useState<any[]>([]);
  const [lectures, setLectures] = useState<any[]>([]);
  const [backups, setBackups] = useState<BackupSession[]>([]);
  const [telemetry, setTelemetry] = useState<DeploymentTelemetry | null>(null);

  // Actions states
  const [resetConfirmStage, setResetConfirmStage] = useState(0); // 0, 1, 2, 3
  const [actionLoading, setActionLoading] = useState(false);
  const [errorLogsFilter, setErrorLogsFilter] = useState<'all' | 'unresolved' | 'resolved'>('all');
  const [dialogState, setDialogState] = useState<{ isOpen: boolean; actionType: 'restore' | 'delete' | null; backupId: string | null }>({ isOpen: false, actionType: null, backupId: null });

  // Load Tab-specific data
  useEffect(() => {
    loadTabInitData();
  }, [activeTab]);

  const loadTabInitData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'activity') {
        const [usersData, eventsData] = await Promise.all([
          adminService.fetchUsers(),
          adminService.fetchEvents(1, 50)
        ]);
        setUsers(usersData);
        setEvents(eventsData);
      } else if (activeTab === 'visibility') {
        // Load courses and lectures directly using bypass policies
        const [cRes, lRes] = await Promise.all([
          (supabase as any).from('courses').select('id, title, description, color, is_archived, created_at').order('created_at', { ascending: false }),
          supabase.from('lectures').select('id, title, is_archived, created_at, course_id').order('created_at', { ascending: false })
        ]);
        setCourses(cRes.data || []);
        setLectures(lRes.data || []);
      } else if (activeTab === 'errors') {
        const errsResponse = await adminService.fetchErrors();
        setSentryErrors(errsResponse.data);
        setSentryConfig(errsResponse.config_help || null);
      } else if (activeTab === 'reset') {
        const backupsData = await adminService.fetchBackups();
        setBackups(backupsData);
      } else if (activeTab === 'deployment') {
        const telemetryData = await adminService.fetchDeploymentInfo();
        setTelemetry(telemetryData);
      }
    } catch (err: any) {
      toast({
        title: 'Error loading dashboard data',
        description: err.message || 'Please check your connection and try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Toggle Visibility Actions
  const handleToggleCourse = async (courseId: string) => {
    try {
      const res = await adminService.toggleCourseVisibility(courseId);
      setCourses(courses.map(c => c.id === courseId ? { ...c, is_archived: res.is_archived } : c));
      toast({
        title: res.is_archived ? 'Course archived' : 'Course published',
        description: `Students can ${res.is_archived ? 'no longer' : 'now'} view this course.`,
      });
    } catch (err: any) {
      toast({
        title: 'Visibility update failed',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  const handleToggleLecture = async (lectureId: string) => {
    try {
      const res = await adminService.toggleLectureVisibility(lectureId);
      setLectures(lectures.map(l => l.id === lectureId ? { ...l, is_archived: res.is_archived } : l));
      toast({
        title: res.is_archived ? 'Lecture archived' : 'Lecture published',
        description: `Students can ${res.is_archived ? 'no longer' : 'now'} view this lecture.`,
      });
    } catch (err: any) {
      toast({
        title: 'Visibility update failed',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  // Reset Analytics Action
  const handleResetAnalytics = async () => {
    setActionLoading(true);
    try {
      const res = await adminService.resetAnalytics();
      toast({
        title: 'Database successfully reset',
        description: `Analytics cleared. Snapshot backup ${res.backup_id} created successfully.`,
      });
      setResetConfirmStage(0);
      await loadTabInitData(); // refresh backups
    } catch (err: any) {
      toast({
        title: 'Reset failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Restore Backup Action
  const handleRestoreBackup = async (backupId: string) => {
    setDialogState({ isOpen: true, actionType: 'restore', backupId });
  };

  const executeRestoreBackup = async (backupId: string) => {
    setActionLoading(true);
    try {
      await adminService.restoreBackup(backupId);
      toast({
        title: 'Snapshot restored',
        description: 'All analytic data, student progress, XP, and event logs have been restored.',
      });
      await loadTabInitData();
    } catch (err: any) {
      toast({
        title: 'Restore failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
      setDialogState({ isOpen: false, actionType: null, backupId: null });
    }
  };

  // Delete Backup Action
  const handleDeleteBackup = async (backupId: string) => {
    setDialogState({ isOpen: true, actionType: 'delete', backupId });
  };

  const executeDeleteBackup = async (backupId: string) => {
    setActionLoading(true);
    try {
      await adminService.deleteBackup(backupId);
      toast({
        title: 'Backup deleted',
        description: 'The backup snapshot has been permanently removed from the database.',
      });
      setBackups(backups.filter(b => b.id !== backupId));
    } catch (err: any) {
      toast({
        title: 'Deletion failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
      setDialogState({ isOpen: false, actionType: null, backupId: null });
    }
  };

  // Format Helper
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="container mx-auto p-4 lg:p-10 max-w-7xl space-y-8 min-h-screen text-foreground select-none">
      
      {/* Glow effects */}
      <div className="absolute top-[10%] left-[20%] w-[300px] h-[300px] bg-primary/5 rounded-full blur-[100px] pointer-events-none opacity-40" style={{ transform: 'translateZ(0)' }} />
      <div className="absolute bottom-[20%] right-[10%] w-[400px] h-[400px] bg-secondary/5 rounded-full blur-[100px] pointer-events-none opacity-40" style={{ transform: 'translateZ(0)' }} />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-[14px] bg-gradient-to-br from-primary to-destructive flex items-center justify-center shadow-glow-primary">
              <Server className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-3xl lg:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text">
              Platform Admin Console
            </h1>
          </div>
          <p className="text-sm text-muted-foreground font-medium">
            Monitor users, manage course availability, analyze Sentry logs, and control deployments.
          </p>
        </div>
        
        <Button 
          variant="outline"
          size="sm"
          onClick={loadTabInitData}
          disabled={loading || actionLoading}
          className="h-11 px-5 rounded-xl bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10 transition-all font-bold gap-2 text-foreground relative overflow-hidden group self-start"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
          <span>Sync Diagnostics</span>
        </Button>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-black/30 border border-white/5 backdrop-blur-xl rounded-[20px] relative z-10" role="tablist" aria-label="Admin Dashboard Navigation">
        {[
          { id: 'activity', label: 'Activity Tracker', icon: Users },
          { id: 'visibility', label: 'Student Visibility', icon: Eye },
          { id: 'errors', label: 'Sentry Diagnostics', icon: ShieldAlert },
          { id: 'reset', label: 'Reset & Restore', icon: Database },
          { id: 'deployment', label: 'Deployment Control', icon: Cpu },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id as ActiveTab)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-bold rounded-[14px] transition-all relative focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none ${
                isActive ? 'text-white' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="adminActiveTab"
                  className="absolute inset-0 bg-white/10 rounded-[14px] border border-white/5"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <tab.icon className="relative z-10 h-4.5 w-4.5" />
              <span className="relative z-10">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="relative z-10">
        {loading ? (
          <div className="h-[400px] flex flex-col items-center justify-center bg-white/2 border border-white/5 rounded-[24px] gap-4 backdrop-blur-md">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-glow-primary" />
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground animate-pulse">Syncing Telemetry...</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              role="tabpanel"
              id={`tabpanel-${activeTab}`}
              aria-labelledby={`tab-${activeTab}`}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              
              {/* Tab 1: Activity Tracker */}
              {activeTab === 'activity' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left Column: User auditing */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="glass-panel border-white/5 rounded-[24px] p-6 space-y-6">
                      <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                          <Users className="h-5 w-5 text-primary" /> Registered Profiles
                        </h2>
                        <span className="text-xs font-black uppercase tracking-widest px-2.5 py-1 bg-primary/10 border border-primary/20 text-primary rounded-full">
                          {users.length} Users
                        </span>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-white/5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              <th className="pb-3 pl-2">User / Email</th>
                              <th className="pb-3">Role</th>
                              <th className="pb-3 text-right">XP / Tier</th>
                              <th className="pb-3 pr-2 text-right">Signup Date</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {users.map(u => (
                              <tr key={u.user_id} className="text-sm hover:bg-white/2 transition-colors">
                                <td className="py-4 pl-2">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-surface-2 border border-white/10 flex items-center justify-center font-bold text-primary">
                                      {u.display_name?.charAt(0).toUpperCase() || u.email.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                      <span className="font-bold text-foreground truncate">{u.display_name || 'Anonymous User'}</span>
                                      <span className="text-xs text-muted-foreground truncate">{u.email}</span>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-4">
                                  <div className="flex flex-wrap gap-1">
                                    {u.roles.map(r => (
                                      <span key={r} className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${
                                        r === 'admin' 
                                          ? 'bg-destructive/10 border-destructive/20 text-destructive' 
                                          : r === 'professor' 
                                            ? 'bg-secondary/10 border-secondary/20 text-secondary' 
                                            : 'bg-xp/10 border-xp/20 text-xp'
                                      }`}>
                                        {r}
                                      </span>
                                    ))}
                                    {u.roles.length === 0 && (
                                      <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border bg-white/5 border-white/10 text-muted-foreground">
                                        student
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-4 text-right">
                                  <div className="flex flex-col items-end">
                                    <span className="font-bold text-foreground">{u.total_xp.toLocaleString()} XP</span>
                                    <span className="text-xs text-muted-foreground">Lvl {u.current_level}</span>
                                  </div>
                                </td>
                                <td className="py-4 pr-2 text-right text-xs text-muted-foreground">
                                  {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Interaction Ticker */}
                  <div className="space-y-6">
                    <div className="glass-panel border-white/5 rounded-[24px] p-6 space-y-6">
                      <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                          <Activity className="h-5 w-5 text-secondary" /> Activity Feed
                        </h2>
                        <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-glow-success" />
                      </div>

                      <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                        {events.length === 0 ? (
                          <div className="text-center py-10 text-muted-foreground text-sm">
                            No recent interaction events.
                          </div>
                        ) : (
                          events.map(ev => (
                            <div key={ev.id} className="p-4 rounded-xl bg-white/2 border border-white/5 hover:border-white/10 transition-all space-y-2">
                              <div className="flex items-center justify-between">
                                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${
                                  ev.event_type === 'login' 
                                    ? 'bg-secondary/25 text-secondary' 
                                    : ev.event_type === 'lecture_complete' 
                                      ? 'bg-emerald-500/25 text-emerald-400' 
                                      : ev.event_type === 'quiz_attempt'
                                        ? 'bg-purple-500/25 text-purple-400'
                                        : 'bg-primary/25 text-primary'
                                }`}>
                                  {ev.event_type.replace('_', ' ')}
                                </span>
                                <div className="flex items-center text-[10px] text-muted-foreground gap-1">
                                  <Clock className="h-3 w-3" />
                                  <span>{new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                </div>
                              </div>
                              
                              <p className="text-xs font-bold text-foreground">
                                {ev.user_name || ev.user_email || 'Anonymous'}
                              </p>

                              {ev.event_data && Object.keys(ev.event_data).length > 0 && (
                                <pre className="text-[10px] font-mono text-muted-foreground bg-black/40 p-2 rounded-md overflow-x-auto max-w-full">
                                  {JSON.stringify(ev.event_data, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Content Visibility */}
              {activeTab === 'visibility' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Courses visibility */}
                  <div className="glass-panel border-white/5 rounded-[24px] p-6 space-y-6">
                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                      <h2 className="text-xl font-bold flex items-center gap-2">
                        <Eye className="h-5 w-5 text-primary" /> Course Catalog Control
                      </h2>
                    </div>

                    <div className="space-y-4">
                      {courses.length === 0 ? (
                        <div className="text-center py-10 text-muted-foreground text-sm">
                          No courses available.
                        </div>
                      ) : (
                        courses.map(course => (
                          <div key={course.id} className="p-5 rounded-2xl bg-white/2 border border-white/5 hover:border-white/10 transition-all flex items-center justify-between gap-6">
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: course.color || '#3b82f6' }} />
                                <h3 className="font-bold text-foreground truncate">{course.title}</h3>
                              </div>
                              <p className="text-xs text-muted-foreground truncate">{course.description || 'No description provided.'}</p>
                            </div>

                            <button
                              onClick={() => handleToggleCourse(course.id)}
                              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl border transition-all ${
                                course.is_archived 
                                  ? 'bg-destructive/10 border-destructive/20 text-destructive hover:bg-destructive/20' 
                                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                              }`}
                            >
                              {course.is_archived ? (
                                <>
                                  <EyeOff className="h-3.5 w-3.5" />
                                  <span>Hidden (Archived)</span>
                                </>
                              ) : (
                                <>
                                  <Eye className="h-3.5 w-3.5" />
                                  <span>Student Visible</span>
                                </>
                              )}
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Lectures visibility */}
                  <div className="glass-panel border-white/5 rounded-[24px] p-6 space-y-6">
                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                      <h2 className="text-xl font-bold flex items-center gap-2">
                        <Eye className="h-5 w-5 text-secondary" /> Lecture Deck Control
                      </h2>
                    </div>

                    <div className="space-y-4">
                      {lectures.length === 0 ? (
                        <div className="text-center py-10 text-muted-foreground text-sm">
                          No lecture slides available.
                        </div>
                      ) : (
                        lectures.map(lec => (
                          <div key={lec.id} className="p-5 rounded-2xl bg-white/2 border border-white/5 hover:border-white/10 transition-all flex items-center justify-between gap-6">
                            <div className="space-y-1 min-w-0">
                              <h3 className="font-bold text-foreground truncate">{lec.title}</h3>
                              <div className="flex items-center text-[10px] text-muted-foreground gap-2">
                                <span>ID: {lec.id.slice(0, 8)}...</span>
                                {lec.course_id && <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5">Scoped to Course</span>}
                              </div>
                            </div>

                            <button
                              onClick={() => handleToggleLecture(lec.id)}
                              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl border transition-all ${
                                lec.is_archived 
                                  ? 'bg-destructive/10 border-destructive/20 text-destructive hover:bg-destructive/20' 
                                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                              }`}
                            >
                              {lec.is_archived ? (
                                <>
                                  <EyeOff className="h-3.5 w-3.5" />
                                  <span>Hidden (Archived)</span>
                                </>
                              ) : (
                                <>
                                  <Eye className="h-3.5 w-3.5" />
                                  <span>Student Visible</span>
                                </>
                              )}
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: System Diagnostics (Sentry) */}
              {activeTab === 'errors' && (
                <div className="space-y-6">
                  {sentryConfig && (
                    <div className="p-5 border border-yellow-500/20 bg-yellow-500/5 rounded-[20px] flex items-start gap-4 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-yellow-500/5 blur-xl rounded-full" />
                      <Info className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h4 className="font-bold text-yellow-500 text-sm">Sentry API Integration Configuration Pending</h4>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {sentryConfig.message} Current values: Project: <code className="px-1 py-0.5 bg-black/40 rounded">{sentryConfig.project || 'None'}</code>, Organization: <code className="px-1 py-0.5 bg-black/40 rounded">{sentryConfig.org || 'None'}</code>. Showing simulated errors below for demonstration.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="glass-panel border-white/5 rounded-[24px] p-6 space-y-6">
                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                      <h2 className="text-xl font-bold flex items-center gap-2">
                        <ShieldAlert className="h-5 w-5 text-destructive animate-pulse" /> Sentry Error Diagnostics
                      </h2>
                      
                      {/* Filter Toggles */}
                      <div className="flex items-center gap-1.5 p-1 bg-black/35 rounded-xl border border-white/5">
                        {['all', 'unresolved', 'resolved'].map(status => (
                          <button
                            key={status}
                            onClick={() => setErrorLogsFilter(status as any)}
                            className={`px-3.5 py-1.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${
                              errorLogsFilter === status 
                                ? 'bg-white/10 text-white border border-white/5' 
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      {sentryErrors
                        .filter(e => errorLogsFilter === 'all' || e.status === errorLogsFilter)
                        .map(err => (
                          <div key={err.id} className="p-5 rounded-2xl bg-white/2 border border-white/5 hover:border-white/10 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="space-y-2 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${
                                  err.level === 'fatal' 
                                    ? 'bg-destructive/20 text-destructive border border-destructive/30 animate-pulse' 
                                    : err.level === 'error'
                                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                      : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                                }`}>
                                  {err.level}
                                </span>
                                <span className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">{err.project}</span>
                              </div>
                              <h3 className="font-bold text-base text-foreground leading-snug break-all">{err.title}</h3>
                              <p className="text-xs font-mono text-muted-foreground truncate">{err.culprit}</p>
                            </div>

                            <div className="flex flex-wrap items-center gap-6 self-start md:self-center">
                              <div className="flex items-center gap-6">
                                <div className="text-center">
                                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Events</p>
                                  <p className="font-bold text-foreground">{err.count}</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Users</p>
                                  <p className="font-bold text-foreground">{err.userCount}</p>
                                </div>
                              </div>

                              <div className="flex flex-col items-end gap-2 shrink-0">
                                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                                  err.status === 'unresolved' 
                                    ? 'bg-destructive/10 text-destructive border border-destructive/20' 
                                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                }`}>
                                  {err.status}
                                </span>
                                <a 
                                  href={err.permalink} 
                                  target="_blank" 
                                  rel="noreferrer"
                                  className="text-xs text-primary font-bold hover:underline flex items-center gap-1 shrink-0"
                                >
                                  <span>Open Sentry</span>
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 4: Reset & Restore */}
              {activeTab === 'reset' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left Column: Reset action card */}
                  <div className="lg:col-span-1 space-y-6">
                    <div className="glass-panel border-white/5 rounded-[24px] p-6 space-y-6 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-destructive/5 blur-xl rounded-full" />
                      
                      <div className="space-y-2 border-b border-white/5 pb-4">
                        <h2 className="text-xl font-bold flex items-center gap-2 text-destructive">
                          <Database className="h-5 w-5" /> Analytics Wipe Center
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          Wipes XP, student progress, quiz answers, and event logs to clean the platform of mock data.
                        </p>
                      </div>

                      {resetConfirmStage === 0 ? (
                        <div className="space-y-4">
                          <div className="p-4 rounded-xl bg-white/2 border border-white/5 text-xs text-muted-foreground leading-relaxed space-y-2">
                            <div className="flex items-center gap-1.5 text-foreground font-bold">
                              <Info className="h-4 w-4 text-primary" />
                              <span>Backed up before wiping</span>
                            </div>
                            <p>Before purging, a full database snapshot backup is written to the backup table. You can restore your data back to this exact state in one click at any time.</p>
                          </div>
                          <Button
                            variant="destructive"
                            className="w-full h-12 rounded-xl font-bold bg-destructive hover:bg-destructive/90 text-white shadow-glow-destructive"
                            onClick={() => setResetConfirmStage(1)}
                          >
                            Reset analytics data
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-4 p-4 border border-destructive/20 bg-destructive/5 rounded-2xl relative">
                          <h4 className="font-bold text-sm text-destructive uppercase tracking-wider flex items-center gap-1.5">
                            <ShieldAlert className="h-4 w-4 animate-bounce" /> Warning: Confirmation Required
                          </h4>
                          
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {resetConfirmStage === 1 && "Confirming stage 1/3: This will log out active sessions and clear student stats. Continue?"}
                            {resetConfirmStage === 2 && "Confirming stage 2/3: Snapshotted data can be restored later. Clear the database?"}
                            {resetConfirmStage === 3 && "Final confirm: Type RESET below to execute."}
                          </p>

                          {resetConfirmStage === 3 && (
                            <input
                              type="text"
                              placeholder="Type RESET here"
                              onChange={(e) => {
                                if (e.target.value === 'RESET') {
                                  handleResetAnalytics();
                                }
                              }}
                              className="w-full h-11 px-4 text-sm bg-black border border-white/10 rounded-xl text-center font-bold tracking-widest text-destructive uppercase focus:border-destructive focus:ring-0"
                            />
                          )}

                          <div className="flex items-center gap-2">
                            {resetConfirmStage < 3 && (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="flex-1 font-bold"
                                onClick={() => setResetConfirmStage(resetConfirmStage + 1)}
                              >
                                Next Confirmation
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 font-bold bg-white/5 border-white/5"
                              onClick={() => setResetConfirmStage(0)}
                              disabled={actionLoading}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Snapshots list */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="glass-panel border-white/5 rounded-[24px] p-6 space-y-6">
                      <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                          <HardDriveDownload className="h-5 w-5 text-primary" /> Snapshot Backups History
                        </h2>
                        <span className="text-xs font-black uppercase tracking-widest px-2.5 py-1 bg-white/5 border border-white/10 text-muted-foreground rounded-full">
                          {backups.length} Backups
                        </span>
                      </div>

                      <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                        {backups.length === 0 ? (
                          <div className="text-center py-12 text-muted-foreground text-sm">
                            No backup snapshots found in database.
                          </div>
                        ) : (
                          backups.map(bk => (
                            <div key={bk.id} className="p-5 rounded-2xl bg-white/2 border border-white/5 hover:border-white/10 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4">
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                    <HardDriveDownload className="h-4 w-4 text-primary" />
                                  </div>
                                  <div>
                                    <p className="font-bold text-foreground text-sm">Analytics Snapshot</p>
                                    <p className="text-[10px] font-mono text-muted-foreground">{bk.id}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-muted-foreground pl-10">
                                  <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {new Date(bk.created_at).toLocaleString()}</span>
                                  <span>•</span>
                                  <span>{formatBytes(bk.size_bytes)}</span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 md:self-center pl-10 md:pl-0">
                                <Button
                                  size="sm"
                                  onClick={() => handleRestoreBackup(bk.id)}
                                  disabled={actionLoading}
                                  className="font-bold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center gap-1.5"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  <span>Restore</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDeleteBackup(bk.id)}
                                  disabled={actionLoading}
                                  className="font-bold rounded-lg hover:bg-destructive/10 hover:text-destructive p-2.5"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 5: Deployment Control */}
              {activeTab === 'deployment' && telemetry && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left Column: Health Gauges */}
                  <div className="lg:col-span-1 space-y-6">
                    <div className="glass-panel border-white/5 rounded-[24px] p-6 space-y-6">
                      <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                          <Cpu className="h-5 w-5 text-primary" /> Health Status
                        </h2>
                      </div>

                      <div className="space-y-4">
                        {[
                          { name: 'Database API', status: telemetry.health.database, desc: `${telemetry.health.database_connections} Active Connections` },
                          { name: 'Gemini AI API', status: telemetry.health.ai_services, desc: telemetry.health.ai_services === 'connected' ? 'API Key Active' : 'Unconfigured' },
                          { name: 'Sentry Core', status: telemetry.health.sentry, desc: telemetry.health.sentry_dsn || 'Not configured' },
                        ].map((srv, idx) => (
                          <div key={idx} className="p-4 rounded-xl bg-white/2 border border-white/5 flex items-center justify-between gap-4">
                            <div className="space-y-0.5">
                              <p className="font-bold text-sm text-foreground">{srv.name}</p>
                              <p className="text-xs text-muted-foreground">{srv.desc}</p>
                            </div>
                            <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${
                              srv.status === 'healthy' || srv.status === 'connected' || srv.status === 'active'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                            }`}>
                              {srv.status === 'connected' || srv.status === 'active' ? 'active' : srv.status}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl space-y-2">
                        <h4 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-1">
                          <Server className="h-4 w-4" /> System Telemetry
                        </h4>
                        <div className="text-xs text-muted-foreground font-mono space-y-1">
                          <p>OS: {telemetry.system.os} {telemetry.system.release}</p>
                          <p>Python: {telemetry.system.python_version}</p>
                          <p>Database Version: Postgres 15+ (Supabase)</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Center Column: Deployment details */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="glass-panel border-white/5 rounded-[24px] p-6 space-y-6">
                      <div className="flex items-center justify-between border-b border-white/5 pb-4">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                          <Terminal className="h-5 w-5 text-secondary" /> Active Environment
                        </h2>
                        <span className="text-xs font-black uppercase tracking-widest px-2.5 py-1 bg-secondary/10 border border-secondary/20 text-secondary rounded-full">
                          {telemetry.environment.ENVIRONMENT}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl bg-white/2 border border-white/5 space-y-2">
                          <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Active Migration Count</h4>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-extrabold text-foreground">{telemetry.deployments.migrations_count}</span>
                            <span className="text-xs text-muted-foreground">SQL migrations applied</span>
                          </div>
                        </div>

                        <div className="p-4 rounded-xl bg-white/2 border border-white/5 space-y-2">
                          <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Current Release Version</h4>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-extrabold text-foreground">{telemetry.deployments.app_version}</span>
                            <span className="text-xs text-muted-foreground">production ready</span>
                          </div>
                        </div>
                      </div>

                      {/* Redacted Env Config values */}
                      <div className="space-y-4">
                        <h3 className="font-bold text-sm text-foreground uppercase tracking-wider">Active Configuration Parameters</h3>
                        <div className="border border-white/5 rounded-2xl overflow-hidden bg-black/20">
                          <div className="grid grid-cols-2 border-b border-white/5 p-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-black/40">
                            <div className="pl-2">Key</div>
                            <div>Value State</div>
                          </div>
                          <div className="divide-y divide-white/5 font-mono text-xs">
                            {Object.entries(telemetry.environment).map(([key, val]) => (
                              <div key={key} className="grid grid-cols-2 p-3.5 hover:bg-white/2 transition-colors">
                                <div className="font-bold text-foreground pl-2">{key}</div>
                                <div className="text-muted-foreground truncate">
                                  {typeof val === 'boolean' 
                                    ? (val ? 'True (Active)' : 'False (Inactive)') 
                                    : (val ? 'Redacted (Configured)' : 'Not Set')
                                  }
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        )}
      </div>

      <AlertDialog open={dialogState.isOpen} onOpenChange={(isOpen) => !isOpen && setDialogState({ isOpen: false, actionType: null, backupId: null })}>
        <AlertDialogContent className="glass-panel border-white/10 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialogState.actionType === 'restore' ? 'Restore Snapshot?' : 'Delete Snapshot?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {dialogState.actionType === 'restore' 
                ? 'Are you sure you want to restore this snapshot? This will replace all current analytics.'
                : 'Permanently delete this backup snapshot? This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10 text-foreground">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                if (dialogState.backupId) {
                  dialogState.actionType === 'restore' 
                    ? executeRestoreBackup(dialogState.backupId)
                    : executeDeleteBackup(dialogState.backupId);
                }
              }}
              className={dialogState.actionType === 'delete' ? 'bg-destructive hover:bg-destructive/90 text-white' : 'bg-primary hover:bg-primary/90 text-white'}
            >
              {dialogState.actionType === 'restore' ? 'Restore' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
