/**
 * Link & verify a university email by domain trust.
 * Reusable in onboarding (academic step) and Settings. Self-contained: loads
 * the caller's current verification state and lets them attach/replace their
 * institutional address. Domain match → institution_verified flips on.
 */
import { useEffect, useState } from 'react';
import { BadgeCheck, Loader2, Mail } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  getMyVerification,
  linkUniversityEmail,
  type LinkEmailReason,
} from '@/services/academicService';

const REASON_MESSAGE: Record<Exclude<LinkEmailReason, 'verified'>, string> = {
  invalid: 'That doesn’t look like a valid email address.',
  taken: 'That email is already linked to another account.',
  unknown_domain: 'We don’t recognize that university domain yet — saved, but not verified.',
  mismatch: 'That email belongs to a different university than the one you selected.',
};

export function UniversityEmailLink({
  className,
  onVerified,
}: {
  className?: string;
  onVerified?: (university: string | null) => void;
}) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);
  const [institution, setInstitution] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getMyVerification()
      .then((v) => {
        if (!alive) return;
        setVerified(v.institutionVerified);
        setLinkedEmail(v.universityEmail);
        setInstitution(v.institution);
        if (v.universityEmail) setEmail(v.universityEmail);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const submit = async () => {
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await linkUniversityEmail(email.trim());
      if (res.verified) {
        setVerified(true);
        setLinkedEmail(email.trim());
        setInstitution(res.university);
        onVerified?.(res.university);
      } else {
        setError(REASON_MESSAGE[res.reason as Exclude<LinkEmailReason, 'verified'>] ?? 'Could not verify.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading verification…
      </div>
    );
  }

  if (verified) {
    return (
      <div className={cn('flex items-center gap-2 rounded-2xl border border-success/30 bg-success/10 px-4 py-3', className)}>
        <BadgeCheck className="h-5 w-5 shrink-0 text-success" />
        <div className="min-w-0 text-sm">
          <span className="font-semibold text-success">Verified</span>
          <span className="text-muted-foreground">
            {' '}· {institution ?? 'Institution'}{linkedEmail ? ` (${linkedEmail})` : ''}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Mail className="h-4 w-4 text-muted-foreground" /> University email
        <span className="text-xs font-normal text-muted-foreground">— get a verified badge</span>
      </label>
      <div className="flex gap-2">
        <Input
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="you@students.uni-marburg.de"
          className="h-12 rounded-2xl border-white/10 bg-white/5"
        />
        <Button onClick={submit} disabled={submitting || !email.trim()} className="h-12 rounded-2xl px-5 font-bold">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
