/**
 * Profile photos — processed on the device before they leave it.
 *
 * Every upload is decoded, centre-cropped to a square, resized to 512px and
 * re-encoded (WebP, JPEG fallback). That one step:
 *  - strips EXIF, including GPS location, which phone photos carry;
 *  - normalises format and size (~30-80 KB instead of multi-MB originals);
 *  - means the bucket only ever holds plain raster images (the bucket itself
 *    also refuses SVG and >2 MB — migration 20261010010000).
 *
 * Files live at avatars/<user_id>/avatar-<ts>.<ext>; storage RLS only lets a
 * user write inside their own folder. A unique name per upload keeps CDN
 * caching safe, and older files are deleted so nothing piles up.
 */
import { supabase } from '@/integrations/supabase/client';

const BUCKET = 'avatars';
const OUTPUT_PX = 512;
export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export class PhotoError extends Error {
  constructor(readonly code: 'type' | 'size' | 'decode' | 'upload') {
    super(code);
  }
}

export function validatePhoto(file: File) {
  if (!ACCEPTED.includes(file.type)) throw new PhotoError('type');
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError('size');
}

/** Square, 512px, metadata-free. */
export async function processPhoto(file: File): Promise<Blob> {
  validatePhoto(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError('decode');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const out = Math.min(OUTPUT_PX, side);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError('decode');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
  bitmap.close?.();

  const encode = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.86));
  // Older Safari can't encode WebP and silently hands back PNG — fall back to JPEG then.
  const webp = await encode('image/webp');
  const blob = webp?.type === 'image/webp' ? webp : await encode('image/jpeg');
  if (!blob) throw new PhotoError('decode');
  return blob;
}

async function deleteAllExcept(userId: string, keep?: string) {
  const { data } = await supabase.storage.from(BUCKET).list(userId, { limit: 100 });
  const stale = (data ?? []).map((f) => `${userId}/${f.name}`).filter((p) => p !== keep);
  if (stale.length) await supabase.storage.from(BUCKET).remove(stale);
}

/** Process, upload, point the profile at it, then clean up older photos. Returns the public URL. */
export async function uploadProfilePhoto(userId: string, file: File): Promise<string> {
  const blob = await processPhoto(file);
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw new PhotoError('upload');
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const { error: profileError } = await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('user_id', userId);
  if (profileError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new PhotoError('upload');
  }
  // Best-effort: a failed cleanup leaves an orphan file, never a broken avatar.
  await deleteAllExcept(userId, path).catch(() => undefined);
  return data.publicUrl;
}

/** Back to Luna: clear the photo and delete the files. */
export async function removeProfilePhoto(userId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('user_id', userId);
  if (error) throw new PhotoError('upload');
  await deleteAllExcept(userId).catch(() => undefined);
}
