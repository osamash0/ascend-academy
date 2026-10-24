/** Luna offers to study together at most once per Lesson per day. A per-viewer convenience. */
const key = (lessonId: string) => `luna-offer:${lessonId}`;
const day = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

export function shouldOffer(lessonId: string, now = new Date()): boolean {
  try {
    return localStorage.getItem(key(lessonId)) !== day(now);
  } catch {
    return false;
  }
}

export function markOffered(lessonId: string, now = new Date()): void {
  try {
    localStorage.setItem(key(lessonId), day(now));
  } catch {
    /* storage blocked: the offer simply doesn't come back today either way */
  }
}
