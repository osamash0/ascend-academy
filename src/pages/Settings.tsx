import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Mail, Camera, Save, Loader2, AlertCircle, Trash2, Download, Lock, Eye, EyeOff, BrainCircuit } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAiModel } from '@/hooks/use-ai-model';
import { supabase } from '@/integrations/supabase/client';
import { exportAccountData, deleteAccountData } from '@/services/studentService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

const PRESET_AVATARS = [
    'https://api.dicebear.com/7.x/bottts/svg?seed=Felix&backgroundColor=b6e3f4',
    'https://api.dicebear.com/7.x/adventurer/svg?seed=Max&backgroundColor=ffdfbf',
    'https://api.dicebear.com/7.x/fun-emoji/svg?seed=Joy&backgroundColor=c0aede',
    'https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=ffdfbf',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Sam&backgroundColor=b6e3f4',
    'https://api.dicebear.com/7.x/personas/svg?seed=Riley&backgroundColor=ffdfbf',
];

export default function Settings() {
    const { user, profile, refreshProfile, signOut } = useAuth();
    const { toast } = useToast();
    const navigate = useNavigate();
    const { aiModel, setAiModel } = useAiModel();

    const [fullName, setFullName] = useState(profile?.full_name || '');
    const [displayName, setDisplayName] = useState((profile as any)?.display_name || '');
    const [isSaving, setIsSaving] = useState(false);
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isChangingPassword, setIsChangingPassword] = useState(false);

    const hasUnsavedChanges = fullName !== (profile?.full_name || '') || displayName !== ((profile as any)?.display_name || '');

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (profile?.full_name) setFullName(profile.full_name);
        if ((profile as any)?.display_name) setDisplayName((profile as any).display_name);
    }, [profile]);

    const handleSaveProfile = async () => {
        if (!user) return;
        setIsSaving(true);

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ full_name: fullName, display_name: displayName || null })
                .eq('user_id', user.id);

            if (error) throw error;

            await refreshProfile();
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
            setIsSaving(false);
        }
    };

    const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        try {
            if (!event.target.files || event.target.files.length === 0) return;
            if (!user) return;

            setIsUploadingAvatar(true);
            const file = event.target.files[0];
            const fileExt = file.name.split('.').pop();
            const filePath = `${user.id}/${Date.now()}.${fileExt}`;

            // Upload image
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, file);

            if (uploadError) {
                throw uploadError;
            }

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from('avatars')
                .getPublicUrl(filePath);

            // Update profile
            const { error: updateError } = await supabase
                .from('profiles')
                .update({ avatar_url: publicUrl })
                .eq('user_id', user.id);

            if (updateError) {
                throw updateError;
            }

            await refreshProfile();
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
            setIsUploadingAvatar(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleSelectPreset = async (url: string) => {
        if (!user) return;
        setIsUploadingAvatar(true);
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ avatar_url: url })
                .eq('user_id', user.id);

            if (error) throw error;

            await refreshProfile();
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
            setIsUploadingAvatar(false);
        }
    };

    return (
        <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-8">
            {/* Unsaved Changes Banner */}
            <AnimatePresence>
                {hasUnsavedChanges && (
                    <motion.div
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        className="flex items-center gap-3 px-4 py-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-sm text-yellow-700 dark:text-yellow-400"
                    >
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>You have unsaved changes. Don't forget to click <strong>Save Changes</strong>.</span>
                    </motion.div>
                )}
            </AnimatePresence>
            <div>
                <h1 className="text-3xl font-bold text-foreground">Settings</h1>
                <p className="text-muted-foreground mt-1">Manage your account preferences and profile details</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Avatar Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="md:col-span-1"
                >
                    <div className="bg-card rounded-2xl border border-border p-6 flex flex-col items-center text-center">
                        <div className="relative mb-6">
                            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-background shadow-xl bg-muted flex items-center justify-center relative group">
                                {profile?.avatar_url ? (
                                    <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                                ) : (
                                    <User className="w-12 h-12 text-muted-foreground" />
                                )}

                                <div
                                    className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <Camera className="w-8 h-8 text-white mb-2" />
                                    <span className="text-white text-xs font-medium">Change Avatar</span>
                                </div>
                            </div>

                            {isUploadingAvatar && (
                                <div className="absolute inset-0 rounded-full flex items-center justify-center bg-background/80 backdrop-blur-sm z-10 border-4 border-background">
                                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
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
                            onChange={handleAvatarUpload}
                            disabled={isUploadingAvatar}
                        />

                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploadingAvatar}
                        >
                            <Camera className="w-4 h-4 mr-2" />
                            Upload Photo
                        </Button>

                        <div className="w-full mt-6 pt-6 border-t border-border">
                            <p className="text-sm font-medium text-foreground mb-3 text-left">Or choose a fun preset:</p>
                            <div className="grid grid-cols-3 gap-3">
                                {PRESET_AVATARS.map((url, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleSelectPreset(url)}
                                        disabled={isUploadingAvatar}
                                        className={`w-full aspect-square rounded-xl flex items-center justify-center p-2 border-2 transition-all 
                                            ${profile?.avatar_url === url
                                                ? 'border-primary bg-primary/10 scale-105'
                                                : 'border-border bg-muted/50 hover:border-primary/50 hover:bg-muted/80'}`}
                                    >
                                        <img src={url} alt={`Preset ${i + 1}`} className="w-full h-full object-contain" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Profile Info Section */}
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
                                    <label className="text-sm font-medium">Full Name</label>
                                    <div className="relative">
                                        <User className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            placeholder="Enter your full name"
                                            className="pl-10"
                                            value={fullName}
                                            onChange={(e) => setFullName(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Display Name (public)</label>
                                    <div className="relative">
                                        <User className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            placeholder="Anonymous (Avatar Only)"
                                            className="pl-10"
                                            value={displayName}
                                            onChange={(e) => setDisplayName(e.target.value)}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">Shown on the leaderboard instead of your avatar only.</p>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Email Address</label>
                                    <div className="relative">
                                        <Mail className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            value={profile?.email || ''}
                                            className="pl-10 opacity-70 cursor-not-allowed"
                                            readOnly
                                            disabled
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">Your email address cannot be changed here.</p>
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-border flex justify-end">
                            <Button onClick={handleSaveProfile} disabled={isSaving || !hasUnsavedChanges}>
                                {isSaving ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <Save className="w-4 h-4 mr-2" />
                                        Save Changes
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </motion.div>

                {/* Security Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="bg-card rounded-2xl border border-border p-6"
                >
                    <h2 className="text-xl font-semibold text-foreground mb-4">Security</h2>
                    <div className="space-y-4">
                        <div>
                            <label className="text-sm font-medium text-foreground mb-1 block">New Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    type={showNewPassword ? 'text' : 'password'}
                                    placeholder="Min. 6 characters"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    autoComplete="new-password"
                                    className="pl-10 pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNewPassword(!showNewPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-foreground mb-1 block">Confirm Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    placeholder="Re-enter your new password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    autoComplete="new-password"
                                    className={`pl-10 pr-10 ${confirmPassword && confirmPassword !== newPassword ? 'border-destructive' : ''}`}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            {confirmPassword && confirmPassword !== newPassword && (
                                <p className="text-xs text-destructive mt-1">Passwords do not match</p>
                            )}
                        </div>
                        <Button
                            disabled={isChangingPassword || !newPassword || newPassword.length < 6 || newPassword !== confirmPassword}
                            onClick={async () => {
                                setIsChangingPassword(true);
                                const { error } = await supabase.auth.updateUser({ password: newPassword });
                                if (error) {
                                    toast({ title: 'Password change failed', description: error.message, variant: 'destructive' });
                                } else {
                                    toast({ title: 'Password updated!', description: 'Your password has been changed successfully.' });
                                    setNewPassword('');
                                    setConfirmPassword('');
                                }
                                setIsChangingPassword(false);
                            }}
                        >
                            {isChangingPassword ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating...</>
                            ) : (
                                <><Lock className="w-4 h-4 mr-2" />Change Password</>
                            )}
                        </Button>
                    </div>
                </motion.div>

                {/* Data & Privacy Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-card rounded-2xl border border-border p-6"
                >
                    <h2 className="text-xl font-semibold text-foreground mb-4">Data & Privacy</h2>

                    {/* Export Data */}
                    <div className="flex items-center justify-between py-4 border-b border-border">
                        <div>
                            <p className="font-medium text-foreground">Export My Data</p>
                            <p className="text-sm text-muted-foreground">Download all your data as a JSON file (Art. 20 DSGVO)</p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={async () => {
                                setIsExporting(true);
                                try {
                                    const exportData = await exportAccountData(user!.id);
                                    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `learnstation-data-${new Date().toISOString().slice(0, 10)}.json`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                    toast({ title: 'Data exported!', description: 'Your data has been downloaded.' });
                                } catch {
                                    toast({ title: 'Export failed', description: 'Please try again.', variant: 'destructive' });
                                }
                                setIsExporting(false);
                            }}
                            disabled={isExporting}
                        >
                            {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                            {isExporting ? 'Exporting...' : 'Export'}
                        </Button>
                    </div>

                    {/* Delete Account */}
                    <div className="pt-4">
                        <p className="font-medium text-destructive mb-1">Danger Zone</p>
                        <p className="text-sm text-muted-foreground mb-3">
                            Permanently delete your account and all associated data. This action cannot be undone.
                        </p>
                        {!showDeleteConfirm ? (
                            <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
                                <Trash2 className="w-4 h-4 mr-2" />
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
                                        onClick={async () => {
                                            setIsDeleting(true);
                                            try {
                                                await deleteAccountData(user!.id);
                                                await signOut();
                                                navigate('/');
                                                toast({ title: 'Account deleted', description: 'Your account and all data have been removed.' });
                                            } catch {
                                                toast({ title: 'Deletion failed', description: 'Please contact support.', variant: 'destructive' });
                                                setIsDeleting(false);
                                            }
                                        }}
                                    >
                                        {isDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                        {isDeleting ? 'Deleting...' : 'Yes, Delete Everything'}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </motion.div>

                {/* AI Preferences Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                    className="md:col-span-3 bg-gradient-to-br from-primary/5 to-primary/10 rounded-2xl border border-primary/20 p-6"
                >
                    <div className="flex items-center gap-3 mb-4">
                        <BrainCircuit className="w-6 h-6 text-primary" />
                        <h2 className="text-xl font-semibold text-foreground">AI Preferences</h2>
                    </div>
                    <p className="text-sm text-muted-foreground mb-6">
                        Choose which AI model powers your intelligent tutor, quizzes, and summaries.
                    </p>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div 
                            onClick={() => setAiModel('llama3')}
                            className={`cursor-pointer rounded-xl border-2 p-4 transition-all ${aiModel === 'llama3' ? 'border-primary bg-primary/10 shadow-sm' : 'border-border bg-card hover:border-primary/50'}`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-semibold text-foreground">Llama 3 (Local)</h3>
                                {aiModel === 'llama3' && <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />}
                            </div>
                            <p className="text-xs text-muted-foreground">Runs locally via Ollama. Completely private and offline, but may be slower depending on your hardware.</p>
                        </div>
                        
                        <div 
                            onClick={() => setAiModel('gemini-2.5-flash')}
                            className={`cursor-pointer rounded-xl border-2 p-4 transition-all ${aiModel === 'gemini-2.5-flash' ? 'border-primary bg-primary/10 shadow-sm' : 'border-border bg-card hover:border-primary/50'}`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-semibold text-foreground">Gemini 2.5</h3>
                                {aiModel === 'gemini-2.5-flash' && <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />}
                            </div>
                            <p className="text-xs text-muted-foreground">Lightning-fast responses powered by Google. Requires an internet connection securely sent over API.</p>
                        </div>

                        <div 
                            onClick={() => setAiModel('groq')}
                            className={`cursor-pointer rounded-xl border-2 p-4 transition-all ${aiModel === 'groq' ? 'border-primary bg-primary/10 shadow-sm' : 'border-border bg-card hover:border-primary/50'}`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-semibold text-foreground">Groq (Llama 3 8B)</h3>
                                {aiModel === 'groq' && <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />}
                            </div>
                            <p className="text-xs text-muted-foreground">Blazing fast free cloud API running Llama 3 8B Instant. Requires internet and GROQ_API_KEY.</p>
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
