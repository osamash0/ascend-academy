import { Navigate, useParams } from 'react-router-dom';
import { getItems } from '../mocks/shelf';

/**
 * The old Studio paths, kept alive. Every one lands on its place in the Library.
 * (Arrow consts on purpose: these are route elements, not screens.)
 */

/** `/v4/library/studio/c/:canvasId` → the page that opens that canvas, preferring your own over a sample. */
export const CanvasRedirect = () => {
  const { canvasId } = useParams<{ canvasId: string }>();
  const matches = getItems().filter((i) => i.opens.kind === 'canvas' && i.opens.canvasId === canvasId);
  const target = matches.find((i) => !i.sample) ?? matches[0];
  return <Navigate replace to={target ? `/v4/library/m/${target.id}` : '/v4/library'} />;
};

/** A fixed destination. */
export const To = ({ to }: { to: string }) => <Navigate replace to={to} />;
