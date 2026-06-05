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

export function toSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

