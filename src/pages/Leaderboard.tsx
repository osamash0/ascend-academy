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
            case 0: return 'text-yellow-400';
            case 1: return 'text-gray-400';
            case 2: return 'text-amber-600';
            default: return 'text-muted-foreground';
        }
    };

    if (loading) {
        return (
            <div className="p-8 pb-24 md:pb-8 flex items-center justify-center min-h-[50vh]">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 pb-24 md:pb-8 max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                    <Trophy className="w-8 h-8 text-primary" />
                    Student Leaderboard
                </h1>
                <p className="text-muted-foreground">Top students ranked by XP. Set your public display name in Settings!</p>
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm"
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs uppercase bg-muted/50 text-muted-foreground border-b border-border">
                            <tr>
                                <th className="px-6 py-4 font-semibold">Rank</th>
                                <th className="px-6 py-4 font-semibold">Student</th>
                                <th className="px-6 py-4 font-semibold text-center">Level</th>
                                <th className="px-6 py-4 font-semibold text-right">Total XP</th>
                            </tr>
                        </thead>
                        <tbody>
                            {students.map((student, index) => {
                                const isCurrentUser = student.id === user?.id;
                                const isTop3 = index < 3;

                                return (
                                    <motion.tr
                                        key={student.id}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: index * 0.05 }}
                                        className={`border-b border-border/50 transition-colors hover:bg-muted/50 ${isCurrentUser ? 'bg-primary/5' : ''
                                            }`}
                                    >
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 font-medium">
                                                {isTop3 ? (
                                                    <Medal className={`w-6 h-6 ${getMedalColor(index)} drop-shadow-sm`} />
                                                ) : (
                                                    <span className="text-muted-foreground font-bold text-lg w-6 text-center">{index + 1}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden border border-border flex-shrink-0">
                                                    {student.avatar_url ? (
                                                        <img src={student.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <Trophy className="w-5 h-5 text-muted-foreground" />
                                                    )}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className={`font-semibold ${isCurrentUser ? 'text-primary' : 'text-foreground'}`}>
                                                        {student.display_name || 'Anonymous User'}
                                                    </span>
                                                    {isCurrentUser && (
                                                        <span className="text-[10px] text-primary uppercase font-bold tracking-wider">You</span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-500 font-semibold text-xs border border-indigo-500/20">
                                                <Star className="w-3.5 h-3.5" />
                                                Lv {student.current_level || 1}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-1.5 font-bold text-xp text-base">
                                                {student.total_xp || 0}
                                                <Zap className="w-4 h-4 fill-xp" />
                                            </div>
                                        </td>
                                    </motion.tr>
                                );
                            })}

                            {students.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                                        No students found on the leaderboard yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </motion.div>
        </div>
    );
}
