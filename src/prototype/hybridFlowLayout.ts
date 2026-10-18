/** Orthogonal SVG routing in a reserved inter-column (or narrow outer) gutter.
 * Inputs are measured DOM bounds; this helper makes no Git relationship claims. */
type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };
export function flowPath(a: Rect, b: Rect, frame: Rect, slot: number, count: number): string {
  const sy = a.top + a.height / 2 - frame.top;
  const ty = Math.max(b.top + 8, Math.min(b.bottom - 8, b.top + b.height / 2 + ((slot % 7) - 3) * 3)) - frame.top;
  if (b.left - a.right >= 20) {
    const sx = a.right - frame.left, tx = b.left - frame.left;
    const port = sx + (tx - sx) * (.2 + .6 * (slot + 1) / (count + 1));
    return `M ${sx} ${sy} H ${port} V ${ty} H ${tx}`;
  }
  const sx = a.right - frame.left, tx = b.right - frame.left;
  const port = frame.width - 8 - (slot % 10) * 4;
  return `M ${sx} ${sy} H ${port} V ${ty} H ${tx}`;
}
