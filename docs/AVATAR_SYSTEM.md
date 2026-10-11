# The Luna avatar system

Every student has one Luna. She is their face across the app, she wears what they have earned, and her mood follows how they study. This page is the map: what exists, where it lives, and the rules that keep it fair.

## The rules

1. **One person, one face, everywhere.** A person is drawn as their uploaded photo, otherwise their Luna, otherwise their initials. Every screen goes through `UserAvatar`; nothing draws a face by hand.
2. **Earned, never bought.** There is no currency (Doc 1, rule 7). Every item is either free or unlocked by something the student did: a rank tier, a level, a best streak, or a badge.
3. **No culture outranks another.** All "where you're from" looks share one unlock (the First Steps badge) and one rarity. A test pins this.
4. **Chosen, never inferred.** A look is always picked by the student, never guessed from a name, language or university.
5. **The server decides.** The browser hides locked gear, but the database refuses it (`enforce_luna_loadout`), so nobody can equip gear they haven't earned.
6. **Warm, never guilting.** Luna's mood after a lapse is *waiting* (hopeful, looking up), never sad.

## Where things live

All in `src/features/avatar/` unless noted.

| Piece | File | What it is |
|---|---|---|
| Catalog | `catalog.ts` | 74 items in 8 slots: outfit, suit, visor, gear, patch, companion, aura, backdrop |
| Unlock rules | `unlocks.ts` | Pure functions: is it unlocked, how close, what unlocked just now |
| Loadout parsing | `loadout.ts` | Turns stored JSON into a valid loadout; drops unknown or unearned items |
| Mood | `mood.ts` | Derives Luna's mood from the streak |
| Renderer | `LunaAvatar.tsx` | The layered SVG Luna (head or full body) |
| Art | `art.tsx`, `bodies.tsx`, `outfits.tsx` | Gear, patches, auras, backdrops, companions, expressions, the puffy suit, 17 looks |
| Everyone's face | `UserAvatar.tsx`, `identity.ts` | Photo, Luna or initials; other people's faces load in one batched call per screen |
| Your Luna | `MyLuna.tsx`, `useAvatar.ts` | The signed-in student's live loadout, progress and save |
| Suit Locker | `SuitLocker.tsx`, `FacePicker.tsx`, `src/pages/AvatarStudio.tsx` | `/avatar`: dress Luna, try locked gear on, choose Luna or a photo |
| Photos | `photo.ts` | Crop to square, resize to 512px, re-encode (strips EXIF/GPS), upload, clean up old files |
| ID card | `IdCard.tsx`, `MyIdCard.tsx`, `IdCardDialog.tsx` | Crew ID (Luna) or Learner Licence (photo); opens from the profile avatar and "My ID" in the account menu |
| Moments | `GearUnlockWatcher.tsx`, `LunaSpinner.tsx` | "Luna found something for you" toast; the app-wide loader |
| Home Luna | `LunaHero.tsx` (PR #81) | The big, live Luna on Home |
| Sealed areas | `viewerLoadout.tsx`, `ViewerLoadoutBridge.tsx` (PR #81) | Lets the auth-free v4 Spaces area draw the viewer's own Luna |

## Slots and looks

- **Outfit** replaces the space suit and takes the helmet off. Two groups:
  - *Where you're from* (10): Gulf, Levant, Türkiye, Texas, Bavaria Lederhosen, Bavaria Dirndl, Scotland, Japan, India, West Africa. All unlock together with First Steps.
  - *What you're into* (7): Cosy (free), Reader (Bookworm), Football (On Fire), Basketball (Sharpshooter), Gym (7-day streak), Gamer (level 10), Graduation (Course Conqueror).
- **Suit, visor, gear, patch** show while Luna wears her space suit (the default).
- **Companion, aura, backdrop** frame her in either case. Avatars under 64px drop the aura and companion so lists stay calm.

## Database

| Migration | What it adds |
|---|---|
| `20261010000100_profile_luna_loadout` | `profiles.luna_loadout` (jsonb, object, at most 2 KB) |
| `20261010010000_luna_avatar_identity` | `get_luna_loadouts(ids)` for other people's faces (signed-in only); avatars bucket limited to WebP/JPEG/PNG and 2 MB |
| `20261011000100_luna_identity_photo` | `get_luna_loadouts` also returns `avatar_url`, so an id alone resolves to the same face |
| `20261012000400_avatar_unlock_guard` | `avatar_items` catalog + `enforce_luna_loadout` trigger: the database refuses unearned gear |

Things to know:
- The `avatar_items` seed is generated from `catalog.ts`. `catalogSync.test.ts` fails if they drift. **When you add or change an item, regenerate the seed rows** in a new migration.
- `enforce_luna_loadout` is `SECURITY INVOKER` on purpose. As `SECURITY DEFINER`, `current_user` would be the owner (`postgres`), and the trusted-role check would let everyone through.
- Supabase grants `EXECUTE` to `anon` on new public functions; `REVOKE ... FROM PUBLIC` doesn't remove it. Revoke from `anon` by name.
- The local app talks to the production database. Apply migrations by hand with `psql --single-transaction`, never `supabase db push`, and check other branches for the same migration version first.

## Adding something

- **A new item:** add it to `catalog.ts` (with an unlock), draw it in the right art file, add its name to `src/i18n/locales/{en,de}/avatar.json`, and regenerate the database seed (see above).
- **A new look:** add it to `OutfitId`, `HOME_LOOKS` or `STYLE_LOOKS` and `LOOKS` in `outfits.tsx`; home looks must use `HOME_LOOK_UNLOCK`.
- **A new place that shows a person:** use `UserAvatar`. Use `MyLuna` when it's the student's own Luna as a guide.

## Dev labs

`/avatar-lab` (sliders for XP, streak and badges; every look; both ID card faces; loader and level-up) and `/ask-luna-lab`. DEV builds only.
