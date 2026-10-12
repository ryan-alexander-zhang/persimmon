// Orthogonal path with a lateral jog, for edges that share a corridor and get a
// center offset (issue-00003). React Flow's getSmoothStepPath draws a straight
// line for perfectly collinear endpoints and ignores a centerX/centerY offset,
// so a manual jogged path is needed to actually separate overlapping edges.

const STUB = 20; // how far the edge runs straight out of a handle before jogging

/** A right-angle path from (sx,sy) to (tx,ty) whose middle run is shifted by
 *  `offset` px off the centreline: sideways for a vertical edge, vertically for a
 *  horizontal one. Returns [svgPath, labelX, labelY]. */
export function offsetOrthogonalPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  vertical: boolean,
  offset: number,
): [string, number, number] {
  if (vertical) {
    const dir = ty >= sy ? 1 : -1;
    const stub = Math.min(STUB, Math.abs(ty - sy) / 3);
    const mx = (sx + tx) / 2 + offset;
    const y1 = sy + dir * stub;
    const y2 = ty - dir * stub;
    const d = `M${sx},${sy} L${sx},${y1} L${mx},${y1} L${mx},${y2} L${tx},${y2} L${tx},${ty}`;
    return [d, mx, (sy + ty) / 2];
  }
  const dir = tx >= sx ? 1 : -1;
  const stub = Math.min(STUB, Math.abs(tx - sx) / 3);
  const my = (sy + ty) / 2 + offset;
  const x1 = sx + dir * stub;
  const x2 = tx - dir * stub;
  const d = `M${sx},${sy} L${x1},${sy} L${x1},${my} L${x2},${my} L${x2},${ty} L${tx},${ty}`;
  return [d, (sx + tx) / 2, my];
}
