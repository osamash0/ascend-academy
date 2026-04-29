import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    User, Mail, Camera, Save, Loader2, Trash2, Download,
    Lock, Eye, EyeOff, BrainCircuit, Shield, CheckCircle2
} from 'lucide-react';
import { useAuth, Profile } from '@/lib/auth';
import { useAiModel } from '@/hooks/use-ai-model';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

// ─── Types ───────────────────────────────────────────────────────────────────

// ... exported Profile from @/lib/auth is used instead

interface ExportData {
    exported_at: string;
    profile: Profile | null;
    progress: unknown[] | null;
    achievements: unknown[] | null;
    learning_events: unknown[] | null;
}

type AiModelOption = 'llama3' | 'gemini-2.5-flash' | 'groq';

// ─── Constants ───────────────────────────────────────────────────────────────

const PRESET_AVATARS = [
    { url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Felix&backgroundColor=b6e3f4', label: 'Robot Felix' },
    { url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Max&backgroundColor=ffdfbf', label: 'Adventurer Max' },
    { url: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=Joy&backgroundColor=c0aede', label: 'Emoji Joy' },
    { url: 'https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=ffdfbf', label: 'Micah Alex' },
    { url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sam&backgroundColor=b6e3f4', label: 'Avatar Sam' },
    { url: 'https://api.dicebear.com/7.x/personas/svg?seed=Riley&backgroundColor=ffdfbf', label: 'Persona Riley' },
] as const;

const AI_MODELS: { id: AiModelOption; name: string; description: string }[] = [
    {
        id: 'llama3',
        name: 'Llama 3 (Local)',
        description: 'Runs locally via Ollama. Completely private and offline, but may be slower depending on your hardware.'
    },
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5',
        description: 'Lightning-fast responses powered by Google. Requires an internet connection securely sent over API.'
    },
    {
        id: 'groq',
        name: 'Groq (Llama 3 8B)',
        description: 'Blazing fast free cloud API running Llama 3 8B Instant. Requires internet and GROQ_API_KEY.'
    },
];

// ─── Custom Hook: Safe Async State ───────────────────────────────────────────

function useSafeAsync() {
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    const safeSetState = useCallback(<T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) => {
        if (isMounted.current) setter(value);
    }, []);

    return { isMounted, safeSetState };
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function AvatarSection({
    profile,
    user,
    onUpdate
}: {
    profile: Profile | null;
    user: { id: string } | null;
    onUpdate: () => Promise<void>;
}) {
    const { toast } = useToast();
    const { safeSetState } = useSafeAsync();
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!event.target.files?.length || !user) return;

        safeSetState(setIsUploading, true);

        try {
            const file = event.target.files[0];
            const fileExt = file.name.split('.').pop();
            const filePath = `${user.id}/${Date.now()}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('avatars')
                .getPublicUrl(filePath);

            const { error: updateError } = await supabase
                .from('profiles')
                .update({ avatar_url: publicUrl })
                .eq('user_id', user.id);

            if (updateError) throw updateError;

            await onUpdate();
            toast({
                title: "Avatar updated",
                description: "Your new profile picture looks great!",
            });
        } catch (error: unknown) {
            toast({
                title: "Error uploading avatar",
                description: error instanceof Error ? error.message : "Please make sure the 'avatars' storage bucket exists and is public.",
                variant: "destructive"
            });
        } finally {
            safeSetState(setIsUploading, false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [user, onUpdate, toast, safeSetState]);

    const handleSelectPreset = useCallback(async (url: string) => {
        if (!user) return;
        safeSetState(setIsUploading, true);

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ avatar_url: url })
                .eq('user_id', user.id);

            if (error) throw error;

            await onUpdate();
            toast({
                title: "Avatar updated",
                description: "Your fun new avatar is set!",
            });
        } catch {
            toast({
                title: "Error updating avatar",
                description: "Failed to update your avatar.",
                variant: "destructive"
            });
        } finally {
            safeSetState(setIsUploading, false);
        }
    }, [user, onUpdate, toast, safeSetState]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="md:col-span-1"
        >
            <div className="bg-card rounded-2xl border border-border p-6 flex flex-col items-center text-center">
                <div className="relative mb-6">
                    <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-background shadow-xl bg-muted flex items-center justify-center relative group">
                        {profile?.avatar_url ? (
                            <img
                                src={profile.avatar_url}
                                alt="Profile avatar"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/initials/svg?seed=${profile.full_name || 'User'}`;
                                }}
                            />
                        ) : (
                            <User className="w-12 h-12 text-muted-foreground" aria-hidden="true" />
                        )}

                        <div
                            className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            onClick={() => fileInputRef.current?.click()}
                            role="button"
                            tabIndex={0}
                            aria-label="Change avatar"
                        >
                            <Camera className="w-8 h-8 text-white mb-2" aria-hidden="true" />
                            <span className="text-white text-xs font-medium">Change Avatar</span>
                        </div>
                    </div>

                    {isUploading && (
                        <div className="absolute inset-0 rounded-full flex items-center justify-center bg-background/80 backdrop-blur-sm z-10 border-4 border-background">
                            <Loader2 className="w-8 h-8 text-primary animate-spin" aria-hidden="true" />
                        </div>
                    )}
                </div>

                <h3 className="font-semibold text-lg">{profile?.full_name || 'Anonymous User'}</h3>
                <p className="text-muted-foreground text-sm mb-6">{profile?.email}</p>

                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                    aria-label="Upload avatar image"
                />

                <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                >
                    <Camera className="w-4 h-4 mr-2" aria-hidden="true" />
                    Upload Photo
                </Button>

                <div className="w-full mt-6 pt-6 border-t border-border">
                    <p className="text-sm font-medium text-foreground mb-3 text-left">Or choose a fun preset:</p>
                    <div className="grid grid-cols-3 gap-3">
                        {PRESET_AVATARS.map((preset, i) => (
                            <button
                                key={preset.url}
                                onClick={() => handleSelectPreset(preset.url)}
                                disabled={isUploading}
                                aria-label={`Select ${preset.label} avatar`}
                                aria-pressed={profile?.avatar_url === preset.url}
                                className={`w-full aspect-square rounded-xl flex items-center justify-center p-2 border-2 transition-all 
                                    ${profile?.avatar_url === preset.url
                                        ? 'border-primary bg-primary/10 scale-105'
                                        : 'border-border bg-muted/50 hover:border-primary/50 hover:bg-muted/80'}`}
                            >
                                <img
                                    src={preset.url}
                                    alt={preset.label}
                                    className="w-full h-full object-contain"
                                    loading="lazy"
                                />
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

function ProfileForm({
    profile,
    user,
    onUpdate
}: {
    profile: Profile | null;
    user: { id: string } | null;
    onUpdate: () => Promise<void>;
}) {
    const { toast } = useToast();
    const { safeSetState } = useSafeAsync();

    const [fullName, setFullName] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    // Only sync on initial load to prevent race conditions
    useEffect(() => {
        if (profile && !isInitialized) {
            setFullName(profile.full_name || '');
            setDisplayName(profile.display_name || '');
            setIsInitialized(true);
        }
    }, [profile, isInitialized]);

    const hasUnsavedChanges = fullName !== (profile?.full_name || '') ||
        displayName !== (profile?.display_name || '');

    const handleSave = useCallback(async () => {
        if (!user) return;
        safeSetState(setIsSaving, true);

        try {
            const { error } = await supabase
                .from('profiles')
                .update({
                    full_name: fullName.trim() || null,
                    display_name: displayName.trim() || null
                })
                .eq('user_id', user.id);

            if (error) throw error;

            await onUpdate();
            toast({
                title: "Profile updated",
                description: "Your settings have been saved successfully.",
            });
        } catch (error: unknown) {
            toast({
                title: "Error saving profile",
                description: error instanceof Error ? error.message : "An unexpected error occurred.",
                variant: "destructive"
            });
        } finally {
            safeSetState(setIsSaving, false);
        }
    }, [user, fullName, displayName, onUpdate, toast, safeSetState]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="md:col-span-2"
        >
            <div className="bg-card rounded-2xl border border-border p-6 space-y-6">
                <div>
                    <h2 className="text-xl font-semibold mb-4">Personal Information</h2>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label htmlFor="fullName" className="text-sm font-medium">Full Name</label>
                            <div className="relative">
                                <User className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                <Input
                                    id="fullName"
                                    placeholder="Enter your full name"
                                    className="pl-10"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    maxLength={100}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="displayName" className="text-sm font-medium">Display Name (public)</label>
                            <div className="relative">
                                <User className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                <Input
                                    id="displayName"
                                    placeholder="Anonymous (Avatar Only)"
                                    className="pl-10"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    maxLength={50}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">Shown on the leaderboard instead of your avatar only.</p>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="email" className="text-sm font-medium">Email Address</label>
                            <div className="relative">
                                <Mail className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                <Input
                                    id="email"
                                    value={profile?.email || ''}
                                    className="pl-10 opacity-70 cursor-not-allowed"
                                    readOnly
                                    disabled
                                    aria-label="Email address (cannot be changed)"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">Your email address cannot be changed here.</p>
                        </div>
                    </div>
                </div>

                <div className="pt-4 border-t border-border flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                        {hasUnsavedChanges ? (
                            <span className="text-amber-500 font-medium">● Unsaved changes</span>
                        ) : (
                            <span className="text-emerald-500 font-medium flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Up to date
                            </span>
                        )}
                    </div>
                    <Button
                        onClick={handleSave}
                        disabled={isSaving || !hasUnsavedChanges}
                        aria-live="polite"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4 mr-2" aria-hidden="true" />
                                Save Changes
                            </>
                        )}
                    </Button>
                </div>
            </div>
        </motion.div>
    );
}

function SecuritySection({ user }: { user: { email?: string } | null }) {
    const { toast } = useToast();
    const { safeSetState } = useSafeAsync();

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isChangingPassword, setIsChangingPassword] = useState(false);

    const passwordsMatch = !confirmPassword || newPassword === confirmPassword;
    const canChangePassword = currentPassword && newPassword.length >= 6 && newPassword === confirmPassword;

    const handleChangePassword = useCallback(async () => {
        if (!user?.email || !canChangePassword) return;
        safeSetState(setIsChangingPassword, true);

        try {
            // Verify current password first
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: user.email,
                password: currentPassword,
            });

            if (signInError) {
                toast({
                    title: 'Current password incorrect',
                    description: 'Please check your current password and try again.',
                    variant: 'destructive'
                });
                return;
            }

            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) {
                toast({ title: 'Password change failed', description: error.message, variant: 'destructive' });
            } else {
                toast({ title: 'Password updated!', description: 'Your password has been changed successfully.' });
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
            }
        } catch (error: unknown) {
            toast({
                title: 'Password change failed',
                description: error instanceof Error ? error.message : 'An unexpected error occurred.',
                variant: 'destructive'
            });
        } finally {
            safeSetState(setIsChangingPassword, false);
        }
    }, [user, currentPassword, newPassword, canChangePassword, toast, safeSetState]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-card rounded-2xl border border-border p-6"
        >
            <div className="flex items-center gap-2 mb-4">
                <Shield className="w-5 h-5 text-primary" aria-hidden="true" />
                <h2 className="text-xl font-semibold text-foreground">Security</h2>
            </div>
            <div className="space-y-4">
                <div>
                    <label htmlFor="currentPassword" className="text-sm font-medium text-foreground mb-1 block">Current Password</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        <Input
                            id="currentPassword"
                            type={showCurrentPassword ? 'text' : 'password'}
                            placeholder="Enter your current password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            autoComplete="current-password"
                            className="pl-10 pr-10"
                        />
                        <button
                            type="button"
                            onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            aria-pressed={showCurrentPassword}
                            aria-label="Toggle current password visibility"
                        >
                            {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                </div>

                <div>
                    <label htmlFor="newPassword" className="text-sm font-medium text-foreground mb-1 block">New Password</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        <Input
                            id="newPassword"
                            type={showNewPassword ? 'text' : 'password'}
                            placeholder="Min. 6 characters"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            autoComplete="new-password"
                            className="pl-10 pr-10"
                            minLength={6}
                        />
                        <button
                            type="button"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            aria-pressed={showNewPassword}
                            aria-label="Toggle new password visibility"
                        >
                            {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                    {newPassword && newPassword.length < 6 && (
                        <p className="text-xs text-destructive mt-1">Password must be at least 6 characters</p>
                    )}
                </div>

                <div>
                    <label htmlFor="confirmPassword" className="text-sm font-medium text-foreground mb-1 block">Confirm Password</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        <Input
                            id="confirmPassword"
                            type={showConfirmPassword ? 'text' : 'password'}
                            placeholder="Re-enter your new password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            autoComplete="new-password"
                            className={`pl-10 pr-10 ${!passwordsMatch ? 'border-destructive' : ''}`}
                        />
                        <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            aria-pressed={showConfirmPassword}
                            aria-label="Toggle confirm password visibility"
                        >
                            {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                    {!passwordsMatch && (
                        <p className="text-xs text-destructive mt-1">Passwords do not match</p>
                    )}
                </div>

                <Button
                    disabled={isChangingPassword || !canChangePassword}
                    onClick={handleChangePassword}
                >
                    {isChangingPassword ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Updating...</>
                    ) : (
                        <><Lock className="w-4 h-4 mr-2" aria-hidden="true" />Change Password</>
                    )}
                </Button>
            </div>
        </motion.div>
    );
}

function DataPrivacySection({
    user,
    signOut,
    navigate
}: {
    user: { id: string } | null;
    signOut: () => Promise<void>;
    navigate: ReturnType<typeof useNavigate>;
}) {
    const { toast } = useToast();
    const { safeSetState } = useSafeAsync();

    const [isExporting, setIsExporting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleExport = useCallback(async () => {
        if (!user) return;
        safeSetState(setIsExporting, true);

        try {
            const [profileRes, progressRes, achievementsRes, eventsRes] = await Promise.all([
                supabase.from('profiles').select('*').eq('user_id', user.id).single(),
                supabase.from('student_progress').select('*').eq('user_id', user.id),
                supabase.from('achievements').select('*').eq('user_id', user.id),
                supabase.from('learning_events').select('*').eq('user_id', user.id),
            ]);

            const exportData: ExportData = {
                exported_at: new Date().toISOString(),
                profile: profileRes.data,
                progress: progressRes.data,
                achievements: achievementsRes.data,
                learning_events: eventsRes.data,
            };

            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `learnstation-data-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            toast({ title: 'Data exported!', description: 'Your data has been downloaded.' });
        } catch {
            toast({ title: 'Export failed', description: 'Please try again.', variant: 'destructive' });
        } finally {
            safeSetState(setIsExporting, false);
        }
    }, [user, toast, safeSetState]);

    const handleDelete = useCallback(async () => {
        if (!user) return;
        safeSetState(setIsDeleting, true);

        try {
            // Sequential deletion to respect potential foreign key constraints
            const tables = ['learning_events', 'student_progress', 'achievements', 'user_roles', 'profiles'];
            
            for (const table of tables) {
                const { error } = await supabase.from(table).delete().eq('user_id', user.id);
                if (error) {
                    console.error(`Error deleting from ${table}:`, error);
                    // We continue for some tables but profiles is critical
                    if (table === 'profiles') throw error;
                }
            }

            await signOut();
            navigate('/');
            toast({ title: 'Account deleted', description: 'Your account and all data have been removed.' });
        } catch (error: any) {
            toast({ 
                title: 'Deletion failed', 
                description: error.message || 'Please contact support.', 
                variant: 'destructive' 
            });
            safeSetState(setIsDeleting, false);
            safeSetState(setShowDeleteConfirm, false);
        }
    }, [user, signOut, navigate, toast, safeSetState]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-card rounded-2xl border border-border p-6"
        >
            <h2 className="text-xl font-semibold text-foreground mb-4">Data & Privacy</h2>

            <div className="flex items-center justify-between py-4 border-b border-border">
                <div>
                    <p className="font-medium text-foreground">Export My Data</p>
                    <p className="text-sm text-muted-foreground">Download all your data as a JSON file (Art. 20 DSGVO)</p>
                </div>
                <Button
                    variant="outline"
                    onClick={handleExport}
                    disabled={isExporting}
                >
                    {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4 mr-2" aria-hidden="true" />}
                    {isExporting ? 'Exporting...' : 'Export'}
                </Button>
            </div>

            <div className="pt-4">
                <p className="font-medium text-destructive mb-1">Danger Zone</p>
                <p className="text-sm text-muted-foreground mb-3">
                    Permanently delete your account and all associated data. This action cannot be undone.
                </p>
                {!showDeleteConfirm ? (
                    <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
                        <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                        Delete My Account
                    </Button>
                ) : (
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30">
                        <p className="text-sm text-destructive font-medium">Are you sure? All data will be permanently deleted.</p>
                        <div className="flex gap-2 shrink-0">
                            <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                disabled={isDeleting}
                                onClick={handleDelete}
                            >
                                {isDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : null}
                                {isDeleting ? 'Deleting...' : 'Yes, Delete Everything'}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

function AiPreferencesSection() {
    const { aiModel, setAiModel } = useAiModel();
    const { toast } = useToast();

    const [pendingModel, setPendingModel] = useState<AiModelOption>(aiModel);
    const hasChanges = pendingModel !== aiModel;

    const handleSave = useCallback(() => {
        setAiModel(pendingModel);
        toast({
            title: 'AI Preference saved',
            description: `Your tutor is now powered by ${AI_MODELS.find(m => m.id === pendingModel)?.name}.`
        });
    }, [pendingModel, setAiModel, toast]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-2xl border border-primary/20 p-6"
        >
            <div className="flex items-center gap-3 mb-4">
                <BrainCircuit className="w-6 h-6 text-primary" aria-hidden="true" />
                <h2 className="text-xl font-semibold text-foreground">AI Preferences</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
                Choose which AI model powers your intelligent tutor, quizzes, and summaries.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {AI_MODELS.map((model) => (
                    <div
                        key={model.id}
                        onClick={() => setPendingModel(model.id)}
                        role="radio"
                        aria-checked={pendingModel === model.id}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setPendingModel(model.id); }}
                        className={`cursor-pointer rounded-xl border-2 p-4 transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
                            ${pendingModel === model.id
                                ? 'border-primary bg-primary/10 shadow-sm'
                                : 'border-border bg-card hover:border-primary/50'}`}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-semibold text-foreground">{model.name}</h3>
                            {pendingModel === model.id && (
                                <CheckCircle2 className="w-5 h-5 text-primary" aria-hidden="true" />
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">{model.description}</p>
                    </div>
                ))}
            </div>

            <AnimatePresence>
                {hasChanges && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex justify-end"
                    >
                        <Button onClick={handleSave}>
                            <Save className="w-4 h-4 mr-2" aria-hidden="true" />
                            Save AI Preference
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

function LoadingSkeleton() {
    return (
        <div className="p-6 lg:p-8 max-w-4xl mx-auto">
            <div className="animate-pulse space-y-8">
                <div className="h-8 bg-muted rounded w-1/3" />
                <div className="h-4 bg-muted rounded w-1/2" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="h-96 bg-muted rounded-2xl" />
                    <div className="md:col-span-2 h-96 bg-muted rounded-2xl" />
                </div>
            </div>
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Settings() {
    const { user, profile, refreshProfile, signOut } = useAuth();
    const navigate = useNavigate();

    if (!profile) {
        return <LoadingSkeleton />;
    }

    return (
        <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-foreground">Settings</h1>
                <p className="text-muted-foreground mt-1">Manage your account preferences and profile details</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <AvatarSection
                    profile={profile as Profile}
                    user={user}
                    onUpdate={refreshProfile}
                />
                <ProfileForm
                    profile={profile as Profile}
                    user={user}
                    onUpdate={refreshProfile}
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <SecuritySection user={user} />
                <DataPrivacySection
                    user={user}
                    signOut={signOut}
                    navigate={navigate}
                />
            </div>

            <AiPreferencesSection />
        </div>
    );
}