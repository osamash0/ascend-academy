import { Navigate, useLocation, useParams } from 'react-router-dom';
import { shelfActions } from '../data/useShelf';

/**
 * The old paths, kept alive. Every one lands on its place in the Library,
 * carrying the query it came with (`?mock=` and the like).
 * (Arrow consts on purpose: these are route elements, not screens.)
 */

/** `to` plus the current query; a key already in `to` wins. */
const withSearch = (to: string, search: string): string => {
  const [path, query = ''] = to.split('?');
  const next = new URLSearchParams(query);
  new URLSearchParams(search).forEach((v, k) => {
    if (!next.has(k)) next.set(k, v);
  });
  const q = next.toString();
  return q ? `${path}?${q}` : path;
};

/** `/v4/library/studio/c/:canvasId` → the page that opens that canvas, preferring your own over a sample. */
export const CanvasRedirect = () => {
  const { canvasId } = useParams<{ canvasId: string }>();
  const { search } = useLocation();
  const matches = shelfActions.getItems().filter((i) => i.opens.kind === 'canvas' && i.opens.canvasId === canvasId);
  const target = matches.find((i) => !i.sample) ?? matches[0];
  return <Navigate replace to={withSearch(target ? `/v4/library/m/${target.id}` : '/v4/library', search)} />;
};

/** A fixed destination. */
export const To = ({ to }: { to: string }) => {
  const { search } = useLocation();
  return <Navigate replace to={withSearch(to, search)} />;
};
