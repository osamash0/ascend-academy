import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, Clock, TrendingUp, DollarSign } from 'lucide-react';
import { adminService, UserDetail } from '@/services/adminService';

interface UserDetailDrawerProps {
  userId: string | null;
  onClose: () => void;
  onRoleChanged: () => void;
}

export function UserDetailDrawer({ userId, onClose, onRoleChanged }: UserDetailDrawerProps) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [roleLoading, setRoleLoading] = useState(false);

  useEffect(() => {
    if (userId) {
      loadDetail();
    } else {
      setDetail(null);
    }
  }, [userId]);

  const loadDetail = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await adminService.fetchUserDetail(userId);
      setDetail(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleToggle = async (role: string) => {
    if (!userId || !detail) return;
    const hasRole = detail.profile.roles.includes(role);
    setRoleLoading(true);
    try {
      await adminService.updateUserRole(userId, role, hasRole ? 'remove' : 'add');
      await loadDetail();
      onRoleChanged();
    } catch (e) {
      console.error(e);
      alert('Failed to update role');
    } finally {
      setRoleLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {userId && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-[#0a0a0c] border-l border-white/10 shadow-2xl z-50 flex flex-col overflow-hidden"
          >
            {loading || !detail ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              </div>
            ) : (
              <>
                <div className="p-6 border-b border-white/10 flex justify-between items-start bg-white/5">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 p-[2px]">
                      <div className="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden">
                        {detail.profile.avatar_url ? (
                          <img src={detail.profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xl font-bold text-white">
                            {detail.profile.display_name?.charAt(0) || detail.profile.email.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white">{detail.profile.display_name || detail.profile.full_name || 'Anonymous'}</h2>
                      <p className="text-sm text-slate-400">{detail.profile.email}</p>
                    </div>
                  </div>
                  <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                  {/* Roles Section */}
                  <section>
                    <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Shield className="w-4 h-4" /> Role Management
                    </h3>
                    <div className="space-y-3">
                      {['admin', 'professor', 'student'].map(role => (
                        <div key={role} className="flex items-center justify-between p-3 rounded-lg border border-white/10 bg-white/5">
                          <span className="capitalize text-white font-medium">{role}</span>
                          <button
                            disabled={roleLoading}
                            onClick={() => handleRoleToggle(role)}
                            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                              detail.profile.roles.includes(role)
                                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                                : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30'
                            } disabled:opacity-50`}
                          >
                            {detail.profile.roles.includes(role) ? 'Remove' : 'Add'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Stats Section */}
                  <section>
                    <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" /> Platform Stats
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 rounded-xl border border-white/10 bg-white/5">
                        <p className="text-xs text-slate-400 mb-1">Level</p>
                        <p className="text-2xl font-bold text-white">{detail.profile.current_level}</p>
                      </div>
                      <div className="p-4 rounded-xl border border-white/10 bg-white/5">
                        <p className="text-xs text-slate-400 mb-1">Total XP</p>
                        <p className="text-2xl font-bold text-white">{detail.profile.total_xp}</p>
                      </div>
                      <div className="p-4 rounded-xl border border-white/10 bg-white/5 col-span-2 flex justify-between items-center">
                        <div>
                          <p className="text-xs text-slate-400 mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3"/> AI Cost (Month)</p>
                          <p className="text-xl font-bold text-orange-400">${detail.monthly_spend_usd.toFixed(4)}</p>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Recent Activity */}
                  <section>
                    <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Clock className="w-4 h-4" /> Recent Activity
                    </h3>
                    <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-white/10 before:to-transparent">
                      {detail.recent_events.length === 0 ? (
                        <p className="text-sm text-slate-500 text-center py-4">No recent activity found.</p>
                      ) : (
                        detail.recent_events.map(event => (
                          <div key={event.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                            <div className="flex items-center justify-center w-4 h-4 rounded-full border border-white/30 bg-black text-slate-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10" />
                            <div className="w-[calc(100%-2.5rem)] md:w-[calc(50%-1.5rem)] p-3 rounded-lg border border-white/10 bg-white/5">
                              <div className="flex justify-between mb-1">
                                <span className="font-medium text-white text-sm">{event.event_type}</span>
                                <time className="text-xs text-slate-500">
                                  {new Date(event.created_at).toLocaleDateString()}
                                </time>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
