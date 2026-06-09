/** Friend button driven by the live relationship status. */
import { Check, Clock, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RelationshipStatus } from "../data";
import { useFriendActions } from "../hooks";

export function FriendButton({
  userId,
  relationship = "none",
  full = false,
  size = "sm",
}: {
  userId: string;
  relationship?: RelationshipStatus;
  full?: boolean;
  size?: "sm" | "default";
}) {
  const { add, cancel } = useFriendActions();
  const cls = cn(full && "w-full");
  const busy = add.isPending || cancel.isPending;

  if (relationship === "friends") {
    return (
      <Button variant="secondary" size={size} className={cls} disabled>
        <Check className="h-4 w-4" /> Friends
      </Button>
    );
  }
  if (relationship === "incoming") {
    return (
      <Button variant="outline" size={size} className={cls} disabled>
        <Clock className="h-4 w-4" /> Awaiting you
      </Button>
    );
  }
  if (relationship === "pending_outgoing") {
    return (
      <Button variant="outline" size={size} className={cls} disabled={busy} onClick={() => cancel.mutate(userId)}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />} Pending
      </Button>
    );
  }
  return (
    <Button variant="default" size={size} className={cls} disabled={busy} onClick={() => add.mutate(userId)}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add friend
    </Button>
  );
}
