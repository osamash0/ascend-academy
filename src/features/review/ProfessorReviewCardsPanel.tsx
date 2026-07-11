/**
 * ProfessorReviewCardsPanel — lets a professor see and hide/unhide a
 * lecture's auto-generated SRS review cards before/after students see them
 * (Roadmap Phase 4.1). Rendered inside LectureUpload's "Lecture" tab,
 * mirroring ProfessorPracticeSheetsTab's placement and style.
 *
 * Cards are soft-hidden, never deleted: hiding stops a card from being
 * served to students but preserves any student's existing SM-2 progress —
 * see backend/api/v1/review.py for the rationale.
 */
import { useCallback, useEffect, useState } from 'react';
import { EyeOff, Eye, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  listLectureReviewCards,
  hideReviewCard,
  unhideReviewCard,
  type ReviewCard,
} from '@/services/reviewCardsService';

interface Props {
  lectureId: string;
}

function cardFrontText(card: ReviewCard): string {
  const q = card.front?.question;
  return typeof q === 'string' && q.trim() ? q : 'Untitled card';
}

export function ProfessorReviewCardsPanel({ lectureId }: Props) {
  const { toast } = useToast();
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCards(await listLectureReviewCards(lectureId));
    } catch (err) {
      console.error(err);
      toast({ title: 'Failed to load review cards', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [lectureId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleHidden = async (card: ReviewCard) => {
    setPendingId(card.card_id);
    try {
      if (card.hidden) {
        await unhideReviewCard(card.card_id);
      } else {
        await hideReviewCard(card.card_id);
      }
      setCards((prev) =>
        prev.map((c) => (c.card_id === card.card_id ? { ...c, hidden: !c.hidden } : c)),
      );
    } catch (err) {
      console.error(err);
      toast({ title: 'Failed to update card', variant: 'destructive' });
    } finally {
      setPendingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No review cards yet. They're generated automatically from this lecture's quiz questions.
      </p>
    );
  }

  const visibleCount = cards.filter((c) => !c.hidden).length;

  return (
    <div className="space-y-3" data-testid="review-cards-panel">
      <p className="text-xs text-muted-foreground">
        {visibleCount} of {cards.length} card{cards.length === 1 ? '' : 's'} visible to students.
      </p>
      <ul className="space-y-2">
        {cards.map((card) => (
          <li
            key={card.card_id}
            className={`flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 ${card.hidden ? 'opacity-50' : ''}`}
          >
            <p className="text-sm text-foreground line-clamp-1 flex-1">{cardFrontText(card)}</p>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-xs shrink-0"
              onClick={() => toggleHidden(card)}
              disabled={pendingId === card.card_id}
              title={card.hidden ? 'Unhide — show to students again' : 'Hide — stop showing to students'}
            >
              {pendingId === card.card_id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : card.hidden ? (
                <Eye className="w-3.5 h-3.5" />
              ) : (
                <EyeOff className="w-3.5 h-3.5" />
              )}
              {card.hidden ? 'Unhide' : 'Hide'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
