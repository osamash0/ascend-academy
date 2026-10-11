/**
 * Your ID as a moment, not a block: it opens over the page (from your
 * profile avatar or the account menu) so its facts never repeat what the
 * screen behind already shows.
 */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { StudentRoutes } from '@/lib/routes';
import { MyIdCard } from './MyIdCard';

export function IdCardDialog({
  children,
  open,
  onOpenChange,
}: {
  /** Optional trigger; omit when controlling `open` from outside (e.g. a menu item). */
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation('avatar');
  const navigate = useNavigate();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="max-w-[460px] border-white/10 bg-black/90 p-6 backdrop-blur">
        <DialogTitle className="text-base font-bold text-white">{t('card.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('card.hint')}</DialogDescription>
        <div className="flex justify-center py-2">
          <MyIdCard />
        </div>
        <button
          type="button"
          onClick={() => {
            onOpenChange?.(false);
            navigate(StudentRoutes.AVATAR);
          }}
          className="mx-auto rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/85 transition hover:bg-white/5 active:scale-[0.98]"
        >
          {t('card.edit')}
        </button>
      </DialogContent>
    </Dialog>
  );
}
