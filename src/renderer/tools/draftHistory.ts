import type { Point } from '../model/schema';

/** Keep unfinished drawing edits out of the world's undo history. */
export function handleDraftHistory(
  event: KeyboardEvent,
  points: Point[],
  removed: Point[],
): boolean {
  const key = event.key.toLowerCase();
  const modified = event.ctrlKey || event.metaKey;
  const undo = (modified && key === 'z' && !event.shiftKey) || key === 'backspace';
  const redo = modified && (key === 'y' || (key === 'z' && event.shiftKey));
  if (event.altKey || (!undo && !redo) || (points.length === 0 && removed.length === 0)) {
    return false;
  }
  event.preventDefault();
  // Consume shortcuts even at the ends of the draft history. Another Ctrl+Z
  // must not suddenly remove the map or layer underneath the drawing.
  if (undo) {
    const point = points.pop();
    if (point) removed.push(point);
  } else {
    const point = removed.pop();
    if (point) points.push(point);
  }
  return true;
}
