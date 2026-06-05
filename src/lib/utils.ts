import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function splitLectureTitle(title: string): { badge: string | null; cleanTitle: string } {
  const match = title.match(/^(\d{1,2}(?:\.\d+)?)\s*(?:[-:]\s*)?(.*)$/);
  if (match) {
    return { badge: match[1], cleanTitle: match[2].trim() || title };
  }
  return { badge: null, cleanTitle: title };
}
