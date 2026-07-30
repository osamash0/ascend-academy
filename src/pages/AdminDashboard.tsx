import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Activity,
  Database,
  RefreshCw,
  Eye,
  Terminal,
  ShieldAlert,
  Cpu,
  Trash2,
  Clock,
  HardDriveDownload,
  Server,
  Search,
  Filter
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { adminService, AdminUser, ActivityEvent, SentryError, BackupSession, DeploymentTelemetry, PlatformStats } from '@/services/adminService';
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

// New Components
import { DepthScene } from '@/components/console/DepthScene';
import { AdminKPISummary } from '@/components/admin/AdminKPISummary';
import { UserDetailDrawer } from '@/components/admin/UserDetailDrawer';
import { ActivityFilters } from '@/components/admin/ActivityFilters';
import { ContentVisibilityPanel } from '@/components/admin/ContentVisibilityPanel';
import { ErrorTrendChart } from '@/components/admin/ErrorTrendChart';
import { HealthGauges } from '@/components/admin/HealthGauges';

type ActiveTab = 'activity' | 'visibility' | 'errors' | 'deployment' | 'backups';

export default function AdminDashboard() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ActiveTab>('activity');
  const [loading, setLoading] = useState(true);

  // Global Stats
  const [stats, setStats] = useState<PlatformStats | null>(null);

  // Users & Events Tab
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [usersPage, setUsersPage] = useState(1);
  const [eventsPage, setEventsPage] = useState(1);
  const [usersTotal, setUsersTotal] = useState(0);
  const [eventsTotal, setEventsTotal] = useState(0);
  
  const [eventSearch, setEventSearch] = useState('');
  const [eventType, setEventType] = useState('');
  const [usersSearch, setUsersSearch] = useState('');
  const [userRole, setUserRole] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Visibility Tab
  const [contentItems, setContentItems] = useState<any[]>([]);

  // Errors Tab
  const [sentryErrors, setSentryErrors] = useState<SentryError[]>([]);
  const [sentryConfig, setSentryConfig] = useState<any>(null);

  // Deployment Tab
  const [telemetry, setTelemetry] = useState<DeploymentTelemetry | null>(null);

  // Backups Tab
  const [backups, setBackups] = useState<BackupSession[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [dialogState, setDialogState] = useState<{ isOpen: boolean; actionType: 'restore' | 'delete' | 'reset' | null; backupId: string | null }>({ isOpen: false, actionType: null, backupId: null });

  // Load Platform Stats on Mount
  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const data = await adminService.fetchPlatformStats();
      setStats(data);
    } catch (e) {
      console.error(e);
    }
  };

  // Load Tab Data
  useEffect(() => {
    loadTabData();
  }, [activeTab, usersPage, eventsPage, eventType, userRole]); // Note: excluding search to allow manual trigger

  const loadTabData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'activity') {
        const [uRes, eRes] = await Promise.all([
          adminService.fetchUsers(usersPage, 20, usersSearch, userRole),
          adminService.fetchEvents(eventsPage, 20, eventType, undefined, undefined, eventSearch)
        ]);
        setUsers(uRes.data || []);
        setUsersTotal(uRes.meta?.total_pages || 1);
        setEvents(eRes.data || []);
        setEventsTotal(eRes.meta?.total_pages || 1);
      } else if (activeTab === 'visibility') {
        const [cRes, lRes] = await Promise.all([
          (supabase as any).from('courses').select('id, title, is_archived'),
          supabase.from('lectures').select('id, title, is_archived')
        ]);
        const combined = [
          ...(cRes.data || []).map((c: any) => ({ ...c, type: 'course' as const })),
          ...(lRes.data || []).map((l: any) => ({ ...l, type: 'lecture' as const }))
        ];
        setContentItems(combined);
      } else if (activeTab === 'errors') {
        const errsResponse = await adminService.fetchErrors();
        setSentryErrors(errsResponse.data || []);
        setSentryConfig(errsResponse.config_help || null);
      } else if (activeTab === 'deployment') {
        const telemetryData = await adminService.fetchDeploymentInfo();
        setTelemetry(telemetryData);
      } else if (activeTab === 'backups') {
        const backupsData = await adminService.fetchBackups();
        setBackups(backupsData || []);
      }
    } catch (err: any) {
      toast({
        title: 'Error loading dashboard data',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Activity Search Trigger
  const handleEventSearch = () => {
    setEventsPage(1);
    loadTabData();
  };

  const handleUsersSearch = () => {
    setUsersPage(1);
    loadTabData();
  };

  // Content Visibility Toggle
  const handleToggleContent = async (id: string, type: 'course' | 'lecture') => {
    try {
      if (type === 'course') {
        const res = await adminService.toggleCourseVisibility(id);
        setContentItems(items => items.map(i => i.id === id ? { ...i, is_archived: res.is_archived } : i));
      } else {
        const res = await adminService.toggleLectureVisibility(id);
        setContentItems(items => items.map(i => i.id === id ? { ...i, is_archived: res.is_archived } : i));
      }
    } catch (e: any) {
      toast({ title: 'Update failed', description: e.message, variant: 'destructive' });
    }
  };

  // Backup Actions
  const handleResetAnalytics = async () => {
    setActionLoading(true);
    try {
      const res = await adminService.resetAnalytics();
      toast({ title: 'Database successfully reset', description: `Snapshot backup ${res.backup_id} created successfully.` });
      await loadTabData();
      await loadStats();
    } catch (err: any) {
      toast({ title: 'Reset failed', description: err.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
      setDialogState({ isOpen: false, actionType: null, backupId: null });
    }
  };

  const executeRestoreBackup = async (backupId: string) => {
    setActionLoading(true);
    try {
      await adminService.restoreBackup(backupId);
      toast({ title: 'Snapshot restored', description: 'Data has been restored.' });
      await loadTabData();
      await loadStats();
    } catch (err: any) {
      toast({ title: 'Restore failed', description: err.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
      setDialogState({ isOpen: false, actionType: null, backupId: null });
    }
  };

  const executeDeleteBackup = async (backupId: string) => {
    setActionLoading(true);
    try {
      await adminService.deleteBackup(backupId);
      toast({ title: 'Backup deleted', description: 'Snapshot permanently removed.' });
      setBackups(backups.filter(b => b.id !== backupId));
    } catch (err: any) {
      toast({ title: 'Deletion failed', description: err.message, variant: 'destructive' });
    } finally {
      setActionLoading(false);
      setDialogState({ isOpen: false, actionType: null, backupId: null });
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-slate-200 font-sans selection:bg-blue-500/30 overflow-x-hidden relative">
      <DepthScene 
        status="progress"
        gradientIndex={0}
      >
        <div className="relative z-10 container mx-auto px-4 py-8 lg:px-8 max-w-[1400px]">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold uppercase tracking-wider mb-4">
              <ShieldAlert className="w-4 h-4" /> System Administration
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white mb-2">Platform Console</h1>
            <p className="text-slate-400 max-w-2xl text-lg">
              Manage users, monitor platform health, and control course visibility.
            </p>
          </div>
          <Button 
            onClick={() => { loadStats(); loadTabData(); }}
            disabled={loading}
            className="bg-white/5 hover:bg-white/10 text-white border border-white/10"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh Data
          </Button>
        </div>

        {/* KPI Summary */}
        <AdminKPISummary stats={stats} loading={stats === null} />

        {/* Main Content Area */}
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          {/* Tabs */}
          <div className="flex overflow-x-auto border-b border-white/10 hide-scrollbar">
            {[
              { id: 'activity', label: 'User Activity', icon: Users },
              { id: 'visibility', label: 'Content Control', icon: Eye },
              { id: 'errors', label: 'Diagnostics', icon: Terminal },
              { id: 'deployment', label: 'Health Status', icon: Cpu },
              { id: 'backups', label: 'Backups', icon: Database },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.id 
                    ? 'text-white border-b-2 border-blue-500 bg-white/5' 
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'activity' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Users List */}
                    <div>
                      <h3 className="text-lg font-bold text-white mb-4">User Directory</h3>
                      <div className="flex flex-col md:flex-row gap-4 mb-6">
                        <div className="relative flex-1">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-4 w-4 text-slate-400" />
                          </div>
                          <input
                            type="text"
                            className="block w-full pl-10 pr-3 py-2 border border-white/10 rounded-lg bg-black/40 text-sm placeholder-slate-400 text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Search users..."
                            value={usersSearch}
                            onChange={(e) => setUsersSearch(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleUsersSearch()}
                          />
                        </div>
                        <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
                          <Filter className="h-4 w-4 text-slate-400 shrink-0" />
                          {[{value: '', label: 'All'}, {value: 'student', label: 'Students'}, {value: 'professor', label: 'Professors'}, {value: 'admin', label: 'Admins'}].map(role => (
                            <button
                              key={role.value || 'all'}
                              onClick={() => setUserRole(role.value)}
                              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                                userRole === role.value
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/5'
                              }`}
                            >
                              {role.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-black/40 border-b border-white/10">
                            <tr>
                              <th className="p-3 font-medium text-slate-400">User</th>
                              <th className="p-3 font-medium text-slate-400">Roles</th>
                              <th className="p-3 font-medium text-slate-400 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {users.map(u => (
                              <tr key={u.user_id} className="hover:bg-white/5">
                                <td className="p-3">
                                  <div className="font-medium text-white">{u.display_name || u.full_name || 'Anonymous'}</div>
                                  <div className="text-xs text-slate-500">{u.email}</div>
                                </td>
                                <td className="p-3">
                                  <div className="flex gap-1 flex-wrap">
                                    {u.roles.map(r => (
                                      <span key={r} className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10px] uppercase font-bold">
                                        {r}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className="p-3 text-right">
                                  <Button size="sm" variant="outline" className="h-7 text-xs bg-transparent border-white/20" onClick={() => setSelectedUserId(u.user_id)}>
                                    View
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="p-3 flex justify-between items-center border-t border-white/10 bg-black/20">
                          <Button size="sm" variant="ghost" disabled={usersPage === 1} onClick={() => setUsersPage(p => p - 1)}>Prev</Button>
                          <span className="text-xs text-slate-500">Page {usersPage} of {usersTotal}</span>
                          <Button size="sm" variant="ghost" disabled={usersPage >= usersTotal} onClick={() => setUsersPage(p => p + 1)}>Next</Button>
                        </div>
                      </div>
                    </div>
                    
                    {/* Event Logs */}
                    <div>
                      <h3 className="text-lg font-bold text-white mb-4">Event Stream</h3>
                      <ActivityFilters 
                        search={eventSearch} 
                        setSearch={setEventSearch} 
                        eventType={eventType} 
                        setEventType={setEventType} 
                        onRefresh={handleEventSearch} 
                      />
                      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                        <div className="max-h-[500px] overflow-y-auto p-4 space-y-3">
                          {events.map(e => (
                            <div key={e.id} className="flex flex-col gap-1 p-3 rounded-lg bg-black/40 border border-white/5">
                              <div className="flex justify-between items-center">
                                <span className="text-sm font-medium text-white">{e.event_type}</span>
                                <span className="text-xs text-slate-500">{new Date(e.created_at).toLocaleString()}</span>
                              </div>
                              <div className="text-xs text-slate-400">{e.user_email || e.user_name || e.user_id}</div>
                            </div>
                          ))}
                          {events.length === 0 && (
                            <div className="text-center py-8 text-slate-500">No events found.</div>
                          )}
                        </div>
                        <div className="p-3 flex justify-between items-center border-t border-white/10 bg-black/20">
                          <Button size="sm" variant="ghost" disabled={eventsPage === 1} onClick={() => setEventsPage(p => p - 1)}>Prev</Button>
                          <span className="text-xs text-slate-500">Page {eventsPage} of {eventsTotal}</span>
                          <Button size="sm" variant="ghost" disabled={eventsPage >= eventsTotal} onClick={() => setEventsPage(p => p + 1)}>Next</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'visibility' && (
                  <ContentVisibilityPanel items={contentItems} onToggle={handleToggleContent} />
                )}

                {activeTab === 'errors' && (
                  <div>
                    <ErrorTrendChart errors={sentryErrors} />
                    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-black/40 border-b border-white/10">
                          <tr>
                            <th className="p-4 font-medium text-slate-400">Issue</th>
                            <th className="p-4 font-medium text-slate-400 text-right">Events</th>
                            <th className="p-4 font-medium text-slate-400 text-right">Users</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {sentryErrors.map(e => (
                            <tr key={e.id} className="hover:bg-white/5">
                              <td className="p-4">
                                <div className="font-medium text-white mb-1 line-clamp-1">{e.title}</div>
                                <div className="text-xs text-slate-500 font-mono line-clamp-1">{e.culprit}</div>
                              </td>
                              <td className="p-4 text-right text-slate-300 font-medium">{e.count}</td>
                              <td className="p-4 text-right text-slate-300 font-medium">{e.userCount}</td>
                            </tr>
                          ))}
                          {sentryErrors.length === 0 && (
                            <tr><td colSpan={3} className="p-8 text-center text-slate-500">No active errors!</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'deployment' && (
                  <HealthGauges info={telemetry} loading={!telemetry} />
                )}

                {activeTab === 'backups' && (
                  <div className="space-y-6 max-w-4xl">
                    <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-xl">
                      <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                        <Trash2 className="w-5 h-5 text-red-400" /> Factory Reset Analytics
                      </h3>
                      <p className="text-slate-400 text-sm mb-4">
                        This will delete ALL user analytics, XP, progress, and chat history. A backup will be taken before deletion. This operation cannot be easily undone.
                      </p>
                      <Button variant="destructive" onClick={() => setDialogState({ isOpen: true, actionType: 'reset', backupId: null })}>
                        Reset Database
                      </Button>
                    </div>

                    <h3 className="text-lg font-bold text-white mt-8 mb-4">Available Backups</h3>
                    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-black/40 border-b border-white/10">
                          <tr>
                            <th className="p-4 font-medium text-slate-400">Snapshot ID</th>
                            <th className="p-4 font-medium text-slate-400">Date</th>
                            <th className="p-4 font-medium text-slate-400 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {backups.map(b => (
                            <tr key={b.id} className="hover:bg-white/5">
                              <td className="p-4 font-mono text-xs text-slate-300">{b.id}</td>
                              <td className="p-4 text-slate-300">{new Date(b.created_at).toLocaleString()}</td>
                              <td className="p-4 text-right space-x-2">
                                <Button size="sm" variant="outline" className="h-8 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" onClick={() => setDialogState({ isOpen: true, actionType: 'restore', backupId: b.id })}>
                                  Restore
                                </Button>
                                <Button size="sm" variant="outline" className="h-8 border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => setDialogState({ isOpen: true, actionType: 'delete', backupId: b.id })}>
                                  Delete
                                </Button>
                              </td>
                            </tr>
                          ))}
                          {backups.length === 0 && (
                            <tr><td colSpan={3} className="p-8 text-center text-slate-500">No backups available.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <UserDetailDrawer 
        userId={selectedUserId} 
        onClose={() => setSelectedUserId(null)} 
        onRoleChanged={loadTabData} 
      />

      <AlertDialog open={dialogState.isOpen} onOpenChange={(open) => !open && setDialogState({ isOpen: false, actionType: null, backupId: null })}>
        <AlertDialogContent className="bg-zinc-950 border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialogState.actionType === 'restore' ? 'Restore Snapshot?' : 
               dialogState.actionType === 'delete' ? 'Delete Snapshot?' : 
               'Factory Reset Database?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {dialogState.actionType === 'restore' && 'This will overwrite current analytics with the selected snapshot.'}
              {dialogState.actionType === 'delete' && 'This snapshot will be permanently deleted.'}
              {dialogState.actionType === 'reset' && 'This will clear all analytics and take a pre-reset snapshot.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                if (dialogState.actionType === 'restore') executeRestoreBackup(dialogState.backupId!);
                if (dialogState.actionType === 'delete') executeDeleteBackup(dialogState.backupId!);
                if (dialogState.actionType === 'reset') handleResetAnalytics();
              }}
              className="bg-red-500 hover:bg-red-600 text-white"
              disabled={actionLoading}
            >
              {actionLoading ? 'Processing...' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </DepthScene>
    </div>
  );
}
