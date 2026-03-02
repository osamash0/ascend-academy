import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, Camera, Save, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
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
    const { user, profile, refreshProfile } = useAuth();
    const { toast } = useToast();

    const [fullName, setFullName] = useState(profile?.full_name || '');
    const [isSaving, setIsSaving] = useState(false);
    const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (profile?.full_name) {
            setFullName(profile.full_name);
        }
    }, [profile]);

    const handleSaveProfile = async () => {
        if (!user) return;
        setIsSaving(true);

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ full_name: fullName })
                .eq('user_id', user.id);

            if (error) throw error;

            await refreshProfile();
            toast({
                title: "Profile updated",
                description: "Your settings have been saved successfully.",
            });
        } catch (error: any) {
            toast({
                title: "Error saving profile",
                description: error.message || "An unexpected error occurred.",
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
            const filePath = `${user.id}-${Math.random()}.${fileExt}`;

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

        } catch (error: any) {
            toast({
                title: "Error uploading avatar",
                description: error.message || "Please make sure the 'avatars' storage bucket exists and is public.",
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
        } catch (error: any) {
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
                            <Button onClick={handleSaveProfile} disabled={isSaving || fullName === profile?.full_name}>
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
            </div>
        </div>
    );
}
