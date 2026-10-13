/**
 * The signed-in student's own ID card, wired to their real data.
 * Photo → Learner Licence; no photo → Crew ID (see IdCard.tsx).
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { badgeName } from './copy';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { rankForXp } from '@/lib/rank';
import { getMyVerification } from '@/services/academicService';
import { isRealPhoto } from './identity';
import { IdCard } from './IdCard';
import { useLoadout } from './useAvatar';

export function MyIdCard({ className }: { className?: string }) {
  const { user, profile } = useAuth();
  const { loadout, badges } = useLoadout();
  const { t } = useTranslation();

  const { data: extra, isPending } = useQuery({
    queryKey: ['id-card-extra', user?.id],
    enabled: !!user?.id,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [verification, created] = await Promise.all([
        getMyVerification().catch(() => null),
        supabase.from('profiles').select('created_at').eq('user_id', user!.id).maybeSingle(),
      ]);
      return {
        institution: verification?.institution ?? null,
        verified: !!verification?.institutionVerified,
        memberSince: created.data?.created_at ? new Date(created.data.created_at) : null,
      };
    },
  });

  if (!user || !profile) return null;
  // Wait for the university + member-since lookup: showing the card early
  // briefly claimed "Learnstation" as the institution, which is not true.
  if (isPending) {
    return <div aria-hidden className={cn('aspect-[1.586] w-full max-w-[420px] animate-pulse rounded-[18px] bg-white/[0.06]', className)} />;
  }
  const newestFirst = [...badges].sort((a, b) => (b.earnedAt ?? '').localeCompare(a.earnedAt ?? '')).map((b) => badgeName(t, b.key));

  return (
    <IdCard
      className={className}
      data={{
        userId: user.id,
        name: profile.display_name || profile.full_name || profile.email.split('@')[0],
        photoUrl: isRealPhoto(profile.avatar_url) ? profile.avatar_url : null,
        loadout,
        rank: rankForXp(profile.total_xp).name,
        level: profile.current_level,
        institution: extra?.institution ?? null,
        verified: extra?.verified ?? false,
        memberSince: extra?.memberSince ?? null,
        badges: newestFirst,
      }}
    />
  );
}
