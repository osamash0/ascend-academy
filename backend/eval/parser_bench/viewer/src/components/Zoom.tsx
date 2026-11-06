/** The page, enlarged; a click anywhere (or Z / Escape in Judge) closes it. */
export function Zoom({ src, onClose }: { src: string | null; onClose: () => void }) {
  if (!src) return null;
  return (
    <div className="zoom" role="dialog" aria-label="The page, enlarged" onClick={onClose}>
      <img src={src} alt="" />
    </div>
  );
}
