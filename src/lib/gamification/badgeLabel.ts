import type { TFunction } from 'i18next';
import type { BadgeDefinition } from '@/services/gamificationService';

/**
 * Localized name/description for a badge. The DB stores canonical English
 * (`def.name` / `def.description`); the UI prefers an i18n override keyed by the
 * stable badge key (`common:achievements.badgeDefs.<key>.{name,description}`) and
 * falls back to the English text when no translation exists.
 */
export function badgeLabel(
  t: TFunction,
  def: Pick<BadgeDefinition, 'key' | 'name' | 'description'>,
): { name: string; description: string } {
  return {
    name: t(`common:achievements.badgeDefs.${def.key}.name`, { defaultValue: def.name }),
    description: t(`common:achievements.badgeDefs.${def.key}.description`, {
      defaultValue: def.description,
    }),
  };
}

/** Localized label for a badge category id (fallback: capitalized id). */
export function categoryLabel(t: TFunction, category: string): string {
  const fallback = category.charAt(0).toUpperCase() + category.slice(1);
  return t(`common:achievements.categories.${category}`, { defaultValue: fallback });
}
