import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Medal, Zap, Star } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

interface StudentProfile {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    total_xp: number;
    current_level: number;
}

export default function Leaderboard() {
    const { user } = useAuth();
    const [students, setStudents] = useState<StudentProfile[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchLeaderboard = async () => {
            try {
                // Fetch student IDs first to ensure we only get students
                const { data: roleData, error: roleError } = await (supabase as any)
                    .from('user_roles')
                    .select('user_id')
                    .eq('role', 'student');

                if (roleError) throw roleError;

                const studentIds = roleData.map((r: any) => r.user_id);

                if (studentIds.length > 0) {
                    const { data: profilesData, error: profilesError } = await (supabase as any)
                        .from('profiles')
                        .select('id, display_name, avatar_url, total_xp, current_level')
                        .in('id', studentIds)
                        .order('total_xp', { ascending: false })
                        .limit(50);

                    if (profilesError) throw profilesError;

                    setStudents(profilesData || []);
                }
            } catch (error) {
                console.error('Error fetching leaderboard:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchLeaderboard();
    }, []);

    const getMedalColor = (index: number) => {
        switch (index) {
            case 0: return 'text-yellow-400 drop-shadow-glow-yellow';
            case 1: return 'text-gray-300 drop-shadow-glow-gray';
            case 2: return 'text-amber-500 drop-shadow-glow-amber';
            default: return 'text-muted-foreground';
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-glow-primary" />
            </div>
        );
    }

    return (
        <div className="relative min-h-screen">
          {/* Animated Background */}
          <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
              <div className="absolute top-[10%] left-[20%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px] animate-pulse" />
              <div className="absolute bottom-[10%] right-[20%] w-[40%] h-[40%] rounded-full bg-secondary/5 blur-[120px] animate-pulse delay-700" />
          </div>

          <div className="p-6 md:p-10 pb-24 md:pb-12 max-w-5xl mx-auto space-y-10 relative z-10">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                  <div>
                    <div className="flex items-center gap-2 text-[10px] font-bold text-primary uppercase tracking-widest mb-3">
                      <Trophy className="w-3 h-3" /> Orbital Rankings
                    </div>
                    <h1 className="text-4xl font-bold tracking-tight text-foreground flex items-center gap-4">
                        Ascend Leaderboard
                    </h1>
                    <p className="text-body-md text-muted-foreground mt-2 max-w-xl">
                      Tracking the highest-performing neural synapses in the academy. Synchronized with live session metrics.
                    </p>
                  </div>
                  
                  <div className="glass-panel px-6 py-4 rounded-2xl flex items-center gap-4 border-white/5">
                    <div className="w-10 h-10 rounded-xl bg-xp/10 flex items-center justify-center">
                      <Zap className="w-5 h-5 text-xp" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Global Status</p>
                      <p className="text-sm font-bold text-foreground">Operational</p>
                    </div>
                  </div>
              </div>

              <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-card border-white/5 rounded-[32px] overflow-hidden shadow-2xl"
              >
                  <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left border-collapse">
                          <thead>
                              <tr className="border-b border-white/5 bg-white/2">
                                  <th className="px-8 py-6 font-bold uppercase tracking-widest text-[10px] text-muted-foreground">Rank</th>
                                  <th className="px-8 py-6 font-bold uppercase tracking-widest text-[10px] text-muted-foreground">Operator</th>
                                  <th className="px-8 py-6 font-bold uppercase tracking-widest text-[10px] text-muted-foreground text-center">Neural Level</th>
                                  <th className="px-8 py-6 font-bold uppercase tracking-widest text-[10px] text-muted-foreground text-right">Experience (XP)</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                              {students.map((student, index) => {
                                  const isCurrentUser = student.id === user?.id;
                                  const isTop3 = index < 3;

                                  return (
                                      <motion.tr
                                          key={student.id}
                                          initial={{ opacity: 0, x: -10 }}
                                          animate={{ opacity: 1, x: 0 }}
                                          transition={{ delay: index * 0.04 }}
                                          className={`group transition-all duration-300 hover:bg-white/5 ${
                                            isCurrentUser ? 'bg-primary/5' : ''
                                          }`}
                                      >
                                          <td className="px-8 py-6">
                                              <div className="flex items-center gap-4">
                                                  {isTop3 ? (
                                                      <div className="relative">
                                                        <motion.div 
                                                          animate={{ scale: [1, 1.2, 1], rotate: [0, 5, -5, 0] }}
                                                          transition={{ duration: 4, repeat: Infinity }}
                                                        >
                                                          <Medal className={`w-8 h-8 ${getMedalColor(index)}`} />
                                                        </motion.div>
                                                        <div className={`absolute -inset-1 blur-md -z-10 opacity-30 ${
                                                          index === 0 ? 'bg-yellow-400' : index === 1 ? 'bg-gray-300' : 'bg-amber-500'
                                                        }`} />
                                                      </div>
                                                  ) : (
                                                      <span className="text-muted-foreground font-bold text-lg w-8 text-center">{index + 1}</span>
                                                  )}
                                              </div>
                                          </td>
                                          <td className="px-8 py-6">
                                              <div className="flex items-center gap-4">
                                                  <div className="relative">
                                                    <div className="w-12 h-12 rounded-2xl bg-surface-2 flex items-center justify-center overflow-hidden border border-white/10 group-hover:border-primary/50 transition-all duration-300 shadow-sm">
                                                        {student.avatar_url ? (
                                                            <img src={student.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="w-full h-full bg-gradient-to-br from-surface-2 to-surface-3 flex items-center justify-center">
                                                              <Trophy className="w-6 h-6 text-muted-foreground/50" />
                                                            </div>
                                                        )}
                                                    </div>
                                                    {isCurrentUser && (
                                                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full border-2 border-background shadow-glow-primary" />
                                                    )}
                                                  </div>
                                                  <div className="flex flex-col">
                                                      <span className={`text-base font-bold transition-colors ${isCurrentUser ? 'text-primary' : 'text-foreground group-hover:text-primary'}`}>
                                                          {student.display_name || 'Anonymous Operator'}
                                                      </span>
                                                      <div className="flex items-center gap-2">
                                                        {isCurrentUser && (
                                                            <span className="text-[10px] text-primary uppercase font-bold tracking-widest">You</span>
                                                        )}
                                                        <span className="text-[10px] text-muted-foreground/50 uppercase font-bold tracking-widest">Active Status</span>
                                                      </div>
                                                  </div>
                                              </div>
                                          </td>
                                          <td className="px-8 py-6 text-center">
                                              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-xl bg-surface-2 text-foreground font-bold text-xs border border-white/5 group-hover:border-primary/20 transition-all">
                                                  <Star className="w-3.5 h-3.5 text-primary" />
                                                  LEVEL {student.current_level || 1}
                                              </div>
                                          </td>
                                          <td className="px-8 py-6 text-right">
                                              <div className="flex items-center justify-end gap-3 font-bold text-xp text-xl tracking-tight">
                                                  {student.total_xp?.toLocaleString() || 0}
                                                  <div className="w-8 h-8 rounded-lg bg-xp/10 flex items-center justify-center">
                                                    <Zap className="w-4 h-4 fill-xp text-xp" />
                                                  </div>
                                              </div>
                                          </td>
                                      </motion.tr>
                                  );
                              })}

                              {students.length === 0 && (
                                  <tr>
                                      <td colSpan={4} className="px-8 py-20 text-center">
                                          <div className="flex flex-col items-center gap-4 opacity-30">
                                            <Trophy className="w-16 h-16" />
                                            <p className="font-bold uppercase tracking-widest text-xs">Waiting for participants...</p>
                                          </div>
                                      </td>
                                  </tr>
                              )}
                          </tbody>
                      </table>
                  </div>
              </motion.div>
          </div>
        </div>
    );
}
