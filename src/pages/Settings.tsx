import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
    User, Mail, Camera, Save, Loader2, Trash2, Download,
    Lock, Eye, EyeOff, BrainCircuit, Shield, CheckCircle2, Languages,
    Settings2, Database, Sliders, Globe, AlertTriangle
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth, Profile } from '@/lib/auth';
import { useLanguagePreference } from '@/hooks/useLanguagePreference';
import { useAiModel } from '@/hooks/use-ai-model';
import { supabase } from '@/integrations/supabase/client';
import { apiClient } from '@/lib/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGamification } from '@/lib/gamification/GamificationProvider';
import { useToast } from '@/hooks/use-toast';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExportData {
    exported_at: string;
    profile: Profile | null;
    progress: unknown[] | null;
    achievements: unknown[] | null;
    learning_events: unknown[] | null;
}

type AiModelOption = 'auto' | 'cerebras' | 'groq' | 'openrouter' | 'cloudflare' | 'openai';

// ─── Constants ───────────────────────────────────────────────────────────────

const PRESET_AVATARS = [
    { url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Felix&backgroundColor=b6e3f4', label: 'Robot Felix' },
    { url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Max&backgroundColor=ffdfbf', label: 'Adventurer Max' },
    { url: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=Joy&backgroundColor=c0aede', label: 'Emoji Joy' },
    { url: 'https://api.dicebear.com/7.x/micah/svg?seed=Alex&backgroundColor=ffdfbf', label: 'Micah Alex' },
    { url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sam&backgroundColor=b6e3f4', label: 'Avatar Sam' },
    { url: 'https://api.dicebear.com/7.x/personas/svg?seed=Riley&backgroundColor=ffdfbf', label: 'Persona Riley' },
] as const;

const AI_MODEL_IDS: AiModelOption[] = ['auto', 'cerebras', 'groq', 'openai', 'openrouter', 'cloudflare'];

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

// ─── Components ──────────────────────────────────────────────────────────────

function GeneralSettings({
    profile,
    user,
    onUpdate
}: {
    profile: Profile | null;
    user: { id: string } | null;
    onUpdate: () => Promise<void>;
}) {
    const { t } = useTranslation(['settings', 'common']);
    const { toast } = useToast();
    const { safeSetState } = useSafeAsync();
    const gamification = useGamification();

    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [fullName, setFullName] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        if (profile && !isInitialized) {
            setFullName(profile.full_name || '');
            setDisplayName(profile.display_name || '');
            setIsInitialized(true);
        }
    }, [profile, isInitialized]);

    const hasUnsavedChanges = fullName !== (profile?.full_name || '') ||
        displayName !== (profile?.display_name || '');

    const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!event.target.files?.length || !user) return;
        safeSetState(setIsUploading, true);

        try {
            const file = event.target.files[0];
            const fileExt = file.name.split('.').pop();
            const filePath = `${user.id}/${Date.now()}.${fileExt}`;

            const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file);
            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
            const { error: updateError } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('user_id', user.id);
            if (updateError) throw updateError;

            await onUpdate();
            gamification.evaluate();
            toast({ title: t('settings:avatar.updated'), description: t('settings:avatar.updatedDescription') });
        } catch (error: unknown) {
            toast({
                title: t('settings:avatar.uploadError'),
                description: error instanceof Error ? error.message : t('settings:avatar.uploadErrorDescription'),
                variant: "destructive"
            });
        } finally {
            safeSetState(setIsUploading, false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [user, onUpdate, toast, safeSetState, gamification, t]);

    const handleSelectPreset = useCallback(async (url: string) => {
        if (!user) return;
        safeSetState(setIsUploading, true);
        try {
            const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('user_id', user.id);
            if (error) throw error;
            await onUpdate();
            gamification.evaluate();
            toast({ title: t('settings:avatar.updated'), description: t('settings:avatar.presetUpdated') });
        } catch {
            toast({ title: t('settings:avatar.presetError'), description: t('settings:avatar.presetErrorDescription'), variant: "destructive" });
        } finally {
            safeSetState(setIsUploading, false);
        }
    }, [user, onUpdate, toast, safeSetState, gamification, t]);

    const handleSaveProfile = useCallback(async () => {
        if (!user) return;
        safeSetState(setIsSaving, true);

        try {
            const { error } = await supabase.from('profiles').update({
                full_name: fullName.trim() || null,
                display_name: displayName.trim() || null
            }).eq('user_id', user.id);

            if (error) throw error;
            await onUpdate();
            gamification.evaluate();
            toast({ title: t('settings:profile.updated'), description: t('settings:profile.updatedDescription') });
        } catch (error: unknown) {
            toast({
                title: t('settings:profile.saveError'),
                description: error instanceof Error ? error.message : t('settings:profile.saveErrorDescription'),
                variant: "destructive"
            });
        } finally {
            safeSetState(setIsSaving, false);
        }
    }, [user, fullName, displayName, onUpdate, toast, safeSetState, gamification, t]);

    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            <div>
                <h2 className="text-xl font-medium text-foreground">{t('settings:profile.personalInfo')}</h2>
                <p className="text-sm text-muted-foreground mt-1">Manage your identity and profile information.</p>
            </div>
            
            <div className="flex flex-col md:flex-row gap-8 pb-8 border-b border-border">
                {/* Avatar Section */}
                <div className="flex-shrink-0 flex flex-col items-center">
                    <div className="relative mb-6 group">
                        <div className="w-24 h-24 rounded-full overflow-hidden border border-border shadow-sm bg-muted flex items-center justify-center relative">
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
                                <User className="w-10 h-10 text-muted-foreground" aria-hidden="true" />
                            )}
                            {isUploading && (
                                <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                                    <Loader2 className="w-6 h-6 text-primary animate-spin" aria-hidden="true" />
                                </div>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                            disabled={isUploading}
                            aria-label={t('settings:avatar.changeAvatar')}
                            className="absolute bottom-0 right-0 p-2 bg-primary text-primary-foreground rounded-full shadow-md transition-transform active:scale-95 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                            <Camera className="w-4 h-4" aria-hidden="true" />
                        </button>
                    </div>

                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} disabled={isUploading} aria-label={t('settings:aria.uploadAvatar')} />

                    <div className="w-full mt-2 max-w-[200px]">
                        <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider text-center">{t('settings:avatar.presetsTitle')}</p>
                        <div className="grid grid-cols-3 gap-2">
                            {PRESET_AVATARS.map((preset) => (
                                <button
                                    key={preset.url}
                                    onClick={() => handleSelectPreset(preset.url)}
                                    disabled={isUploading}
                                    aria-label={`Select ${preset.label} avatar`}
                                    aria-pressed={profile?.avatar_url === preset.url}
                                    className={`w-full aspect-square rounded-lg flex items-center justify-center p-1.5 border transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
                                        ${profile?.avatar_url === preset.url
                                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                            : 'border-transparent bg-muted/50 hover:bg-muted'}`}
                                >
                                    <img src={preset.url} alt={preset.label} className="w-full h-full object-contain" loading="lazy" />
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Profile Form */}
                <div className="flex-grow space-y-6 max-w-xl">
                    <div className="space-y-2">
                        <label htmlFor="fullName" className="text-sm font-medium">{t('settings:profile.fullName')}</label>
                        <Input
                            id="fullName"
                            placeholder={t('settings:profile.fullNamePlaceholder')}
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            maxLength={100}
                        />
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="displayName" className="text-sm font-medium">{t('settings:profile.displayName')}</label>
                        <Input
                            id="displayName"
                            placeholder={t('settings:profile.displayNamePlaceholder')}
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            maxLength={50}
                        />
                        <p className="text-xs text-muted-foreground">{t('settings:profile.displayNameHelp')}</p>
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="email" className="text-sm font-medium">{t('settings:profile.email')}</label>
                        <Input
                            id="email"
                            value={profile?.email || ''}
                            className="bg-muted text-muted-foreground cursor-not-allowed"
                            readOnly
                            disabled
                            aria-label={t('settings:profile.email')}
                        />
                        <p className="text-xs text-muted-foreground">{t('settings:profile.emailHelp')}</p>
                    </div>

                    <div className="pt-2 flex items-center justify-between">
                        <div className="text-sm">
                            {hasUnsavedChanges ? (
                                <span className="text-amber-600 dark:text-amber-500 font-medium">{t('settings:profile.unsavedChanges')}</span>
                            ) : (
                                <span className="text-emerald-600 dark:text-emerald-500 font-medium flex items-center gap-1.5">
                                    <CheckCircle2 className="w-4 h-4" /> {t('settings:profile.upToDate')}
                                </span>
                            )}
                        </div>
                        <Button onClick={handleSaveProfile} disabled={isSaving || !hasUnsavedChanges} aria-live="polite" className="active:scale-[0.98] transition-transform">
                            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4 mr-2" aria-hidden="true" />}
                            {t('settings:save')}
                        </Button>
                    </div>
                </div>
            </div>


        </div>
    );
}

function SecuritySettings({ user }: { user: { email?: string } | null }) {
    const { t } = useTranslation(['settings', 'common']);
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
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: user.email,
                password: currentPassword,
            });

            if (signInError) {
                toast({ title: t('settings:security.currentIncorrect'), description: t('settings:security.currentIncorrectDescription'), variant: 'destructive' });
                return;
            }

            const { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) {
                toast({ title: t('settings:security.passwordChangeFailed'), description: error.message, variant: 'destructive' });
            } else {
                toast({ title: t('settings:security.passwordUpdated'), description: t('settings:security.passwordUpdatedDescription') });
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
            }
        } catch (error: unknown) {
            toast({
                title: t('settings:security.passwordChangeFailed'),
                description: error instanceof Error ? error.message : t('settings:security.passwordChangeFailedDescription'),
                variant: 'destructive'
            });
        } finally {
            safeSetState(setIsChangingPassword, false);
        }
    }, [user, currentPassword, newPassword, canChangePassword, toast, safeSetState, t]);

    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            <div>
                <h2 className="text-xl font-medium text-foreground">{t('settings:security.title')}</h2>
                <p className="text-sm text-muted-foreground mt-1">Update your password to keep your account secure.</p>
            </div>

            <div className="space-y-6 max-w-md">
                <div className="space-y-2">
                    <label htmlFor="currentPassword" className="text-sm font-medium">{t('settings:security.currentPassword')}</label>
                    <div className="relative">
                        <Input
                            id="currentPassword"
                            type={showCurrentPassword ? 'text' : 'password'}
                            placeholder={t('settings:security.currentPasswordPlaceholder')}
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            autoComplete="current-password"
                            className="pr-12"
                        />
                        <button
                            type="button"
                            onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                            className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-pressed={showCurrentPassword}
                            aria-label={t('settings:aria.toggleCurrentPassword')}
                        >
                            {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                </div>

                <div className="space-y-2">
                    <label htmlFor="newPassword" className="text-sm font-medium">{t('settings:security.newPassword')}</label>
                    <div className="relative">
                        <Input
                            id="newPassword"
                            type={showNewPassword ? 'text' : 'password'}
                            placeholder={t('settings:security.newPasswordPlaceholder')}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            autoComplete="new-password"
                            className="pr-12"
                            minLength={6}
                        />
                        <button
                            type="button"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-pressed={showNewPassword}
                            aria-label={t('settings:aria.toggleNewPassword')}
                        >
                            {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                    {newPassword && newPassword.length < 6 && (
                        <p className="text-xs text-destructive">{t('settings:security.passwordTooShort')}</p>
                    )}
                </div>

                <div className="space-y-2">
                    <label htmlFor="confirmPassword" className="text-sm font-medium">{t('settings:security.confirmPassword')}</label>
                    <div className="relative">
                        <Input
                            id="confirmPassword"
                            type={showConfirmPassword ? 'text' : 'password'}
                            placeholder={t('settings:security.confirmPasswordPlaceholder')}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            autoComplete="new-password"
                            className={`pr-12 ${!passwordsMatch ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                        />
                        <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-pressed={showConfirmPassword}
                            aria-label={t('settings:aria.toggleConfirmPassword')}
                        >
                            {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                    {!passwordsMatch && (
                        <p className="text-xs text-destructive">{t('settings:security.passwordsDontMatch')}</p>
                    )}
                </div>

                <Button
                    disabled={isChangingPassword || !canChangePassword}
                    onClick={handleChangePassword}
                    className="w-full sm:w-auto active:scale-[0.98] transition-transform"
                >
                    {isChangingPassword ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Lock className="w-4 h-4 mr-2" aria-hidden="true" />}
                    {isChangingPassword ? t('settings:security.changing') : t('settings:security.changePassword')}
                </Button>
            </div>
        </div>
    );
}

function PreferencesSettings() {
    const { t } = useTranslation(['settings', 'common']);
    const { language, setLanguage } = useLanguagePreference();
    const { aiModel, setAiModel } = useAiModel();
    const { toast } = useToast();

    const [pendingModel, setPendingModel] = useState<AiModelOption>(aiModel as AiModelOption);
    const hasAiChanges = pendingModel !== (aiModel as AiModelOption);

    const handleSaveAi = useCallback(() => {
        setAiModel(pendingModel);
        toast({ title: t('settings:ai.savedTitle'), description: t('settings:ai.savedDescription', { name: t(`settings:ai.models.${pendingModel}.name`) }) });
    }, [pendingModel, setAiModel, toast, t]);

    return (
        <div className="space-y-10 animate-in fade-in duration-300">
            <div>
                <h2 className="text-xl font-medium text-foreground">{t('settings:language.title')}</h2>
                <p className="text-sm text-muted-foreground mt-1 mb-6">{t('settings:language.description')}</p>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                    {(['en', 'de'] as const).map((lng) => {
                        const active = language === lng;
                        return (
                            <button
                                key={lng}
                                type="button"
                                onClick={() => setLanguage(lng)}
                                aria-pressed={active}
                                className={`flex items-center gap-4 p-4 rounded-xl border transition-all active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                                    ${active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:border-primary/50'}`}
                            >
                                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                                    <Globe className="w-5 h-5" aria-hidden="true" />
                                </div>
                                <div className="text-left flex-grow">
                                    <p className="font-medium text-foreground">{lng === 'en' ? 'English' : 'Deutsch'}</p>
                                    <p className="text-xs text-muted-foreground">{lng === 'en' ? t('settings:language.english') : t('settings:language.german')}</p>
                                </div>
                                {active && <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="pt-8 border-t border-border">
                <h2 className="text-xl font-medium text-foreground">{t('settings:ai.preferences')}</h2>
                <p className="text-sm text-muted-foreground mt-1 mb-6">{t('settings:ai.preferencesDescription')}</p>

                <RadioGroup value={pendingModel} onValueChange={(v) => setPendingModel(v as AiModelOption)} className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 max-w-2xl">
                    {AI_MODEL_IDS.map((modelId) => (
                        <div key={modelId} className="relative">
                            <RadioGroupItem value={modelId} id={`ai-${modelId}`} className="sr-only" />
                            <label
                                htmlFor={`ai-${modelId}`}
                                className={`cursor-pointer block rounded-xl border p-4 transition-all active:scale-[0.98] outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2
                                    ${pendingModel === modelId ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:border-primary/50'}`}
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <h3 className="font-medium text-foreground">{t(`settings:ai.models.${modelId}.name`)}</h3>
                                    {pendingModel === modelId && <CheckCircle2 className="w-5 h-5 text-primary" aria-hidden="true" />}
                                </div>
                                <p className="text-sm text-muted-foreground">{t(`settings:ai.models.${modelId}.description`)}</p>
                            </label>
                        </div>
                    ))}
                </RadioGroup>

                {hasAiChanges && (
                    <div className="flex justify-start">
                        <Button onClick={handleSaveAi} className="active:scale-[0.98] transition-transform">
                            <Save className="w-4 h-4 mr-2" aria-hidden="true" />
                            {t('settings:ai.savePreference')}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}

function DataPrivacySettings({ user, signOut, navigate }: { user: { id: string } | null; signOut: () => Promise<void>; navigate: ReturnType<typeof useNavigate>; }) {
    const { t } = useTranslation(['settings', 'common']);
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
                profile: profileRes.data as Profile | null,
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

            toast({ title: t('settings:data.exportSuccess'), description: t('settings:data.exportSuccessDescription') });
        } catch {
            toast({ title: t('settings:data.exportError'), description: t('settings:data.exportErrorDescription'), variant: 'destructive' });
        } finally {
            safeSetState(setIsExporting, false);
        }
    }, [user, toast, safeSetState, t]);

    const handleDelete = useCallback(async () => {
        if (!user) return;
        safeSetState(setIsDeleting, true);

        try {
            let serverDeleted = false;
            try {
                await apiClient.post('/api/auth/delete-account', {});
                serverDeleted = true;
            } catch (e) {
                console.warn('Server-side account deletion unavailable; falling back to client-side row deletion', e);
            }

            if (!serverDeleted) {
                const tables = ['learning_events', 'student_progress', 'achievements', 'user_roles', 'profiles'] as const;
                for (const table of tables) {
                    const { error } = await supabase.from(table).delete().eq('user_id', user.id);
                    if (error) {
                        console.error(`Error deleting from ${table}:`, error);
                        if (table === 'profiles') throw error;
                    }
                }
            }

            await signOut();
            navigate('/');
            toast({ title: t('settings:data.deleteSuccess'), description: t('settings:data.deleteSuccessDescription') });
        } catch (error: unknown) {
            toast({ 
                title: t('settings:data.deleteError'), 
                description: (error instanceof Error ? error.message : '') || t('settings:data.deleteErrorDescription'), 
                variant: 'destructive' 
            });
            safeSetState(setIsDeleting, false);
            safeSetState(setShowDeleteConfirm, false);
        }
    }, [user, signOut, navigate, toast, safeSetState, t]);

    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            <div>
                <h2 className="text-xl font-medium text-foreground">{t('settings:data.title')}</h2>
                <p className="text-sm text-muted-foreground mt-1">Manage your data exports and account deletion.</p>
            </div>

            <div className="max-w-xl border rounded-xl overflow-hidden">
                <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card">
                    <div>
                        <p className="font-medium text-foreground">{t('settings:data.exportTitle')}</p>
                        <p className="text-sm text-muted-foreground mt-1 max-w-[280px]">{t('settings:data.exportDescription')}</p>
                    </div>
                    <Button variant="outline" onClick={handleExport} disabled={isExporting} className="active:scale-[0.98] transition-transform w-full sm:w-auto shrink-0">
                        {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4 mr-2" aria-hidden="true" />}
                        {isExporting ? t('settings:data.exporting') : t('settings:data.exportButton')}
                    </Button>
                </div>
                
                <div className="p-6 border-t border-border bg-destructive/5">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="flex-grow">
                            <p className="font-medium text-destructive">{t('settings:data.dangerZone')}</p>
                            <p className="text-sm text-destructive/80 mt-1 mb-4">{t('settings:data.deleteDescription')}</p>
                            
                            {!showDeleteConfirm ? (
                                <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)} className="active:scale-[0.98] transition-transform">
                                    <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                                    {t('settings:data.deleteButton')}
                                </Button>
                            ) : (
                                <div className="flex flex-col gap-3 p-4 rounded-lg bg-background border border-destructive/20">
                                    <p className="text-sm font-medium text-destructive">{t('settings:data.deleteConfirmShort')}</p>
                                    <div className="flex gap-2">
                                        <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)} className="flex-1">{t('settings:data.cancel')}</Button>
                                        <Button variant="destructive" size="sm" disabled={isDeleting} onClick={handleDelete} className="flex-1 active:scale-[0.98] transition-transform">
                                            {isDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : null}
                                            {isDeleting ? t('settings:data.deleting') : t('settings:data.deleteFinal')}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function LoadingSkeleton() {
    return (
        <div className="animate-pulse space-y-8">
            <div className="h-8 bg-muted rounded w-48" />
            <div className="h-4 bg-muted rounded w-96" />
            <div className="flex flex-col md:flex-row gap-8">
                <div className="w-24 h-24 bg-muted rounded-full shrink-0" />
                <div className="flex-grow space-y-4 max-w-xl">
                    <div className="h-10 bg-muted rounded w-full" />
                    <div className="h-10 bg-muted rounded w-full" />
                    <div className="h-10 bg-muted rounded w-full" />
                </div>
            </div>
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────────────────────────

const TABS = [
    { id: 'general', label: 'General', icon: Settings2 },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'preferences', label: 'Preferences', icon: Sliders },
    { id: 'data', label: 'Data & Privacy', icon: Database },
];

export default function Settings() {
    const { t } = useTranslation(['settings', 'common']);
    const { user, profile, refreshProfile, signOut } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const activeTab = searchParams.get('tab') || 'general';

    const setActiveTab = (tab: string) => {
        setSearchParams({ tab });
    };

    if (!profile) {
        return (
            <div className="container max-w-6xl py-10 mx-auto px-4 md:px-8">
                <LoadingSkeleton />
            </div>
        );
    }

    return (
        <div className="container max-w-6xl py-10 mx-auto px-4 md:px-8">
            <div className="mb-10">
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('settings:header.title')}</h1>
                <p className="text-muted-foreground mt-2">{t('settings:header.subtitle')}</p>
            </div>

            <div className="flex flex-col lg:flex-row gap-10">
                {/* Sidebar Navigation */}
                <aside className="lg:w-1/4 shrink-0 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
                    <nav className="flex lg:flex-col gap-1 min-w-max lg:min-w-0" aria-label="Settings Navigation">
                        {TABS.map((tab) => {
                            const isActive = activeTab === tab.id;
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    aria-current={isActive ? 'page' : undefined}
                                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-ring
                                        ${isActive 
                                            ? 'bg-primary/10 text-primary' 
                                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                        }`}
                                >
                                    <Icon className={`w-4 h-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden="true" />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </nav>
                </aside>

                {/* Main Content Area */}
                <div className="flex-1 lg:max-w-3xl min-h-[500px]">
                    {activeTab === 'general' && (
                        <GeneralSettings profile={profile as Profile} user={user} onUpdate={refreshProfile} />
                    )}
                    {activeTab === 'security' && (
                        <SecuritySettings user={user} />
                    )}
                    {activeTab === 'preferences' && (
                        <PreferencesSettings />
                    )}
                    {activeTab === 'data' && (
                        <DataPrivacySettings user={user} signOut={signOut} navigate={navigate} />
                    )}
                </div>
            </div>
        </div>
    );
}