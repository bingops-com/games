// Un dessin est une liste de traits sur une feuille de 1000 sur 1000 (la page l'étire à
// sa forme). Les points voyagent en texte : deux chiffres en base 36 pour x, deux pour y.
export interface Stroke {
  c: number;
  w: number;
  p: string;
  f?: boolean;
}

// La palette d'un dessin : le serveur ne connaît que le numéro de la couleur.
export const PALETTE = ['#111730', '#8690a3', '#ffffff', '#ff6b5e', '#ff9f43', '#ffcf3f', '#1faa6f', '#14a3c7', '#1443d6', '#8b5cf6', '#ff7ab6', '#8b5a2b'];
// Épaisseurs des traits, pour une feuille large de 1000.
export const WIDTHS = [5, 12, 28];
export const SHEET = { w: 1000, h: 750 };

const d2 = (n: number) => Math.max(0, Math.min(999, Math.round(n))).toString(36).padStart(2, '0');
export const encode = (x: number, y: number) => d2(x) + d2(y);

export function decode(p: string) {
  const pts: [number, number][] = [];
  for (let i = 0; i + 4 <= p.length; i += 4) pts.push([parseInt(p.slice(i, i + 2), 36), parseInt(p.slice(i + 2, i + 4), 36)]);
  return pts;
}

// One bounded, iterative visit per pixel; no recursion or network bitmap.
function fill(ctx: CanvasRenderingContext2D, point: [number, number], color: number) {
  const image = ctx.getImageData(0, 0, SHEET.w, SHEET.h);
  const data = image.data;
  const x = Math.max(0, Math.min(SHEET.w - 1, Math.round(point[0] * SHEET.w / 1000)));
  const y = Math.max(0, Math.min(SHEET.h - 1, Math.round(point[1] * SHEET.h / 1000)));
  const seed = y * SHEET.w + x;
  const target = Array.from(data.slice(seed * 4, seed * 4 + 4));
  const hex = PALETTE[color] ?? PALETTE[0];
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  if (target.every((v, i) => v === (i === 3 ? 255 : rgb[i]))) return;
  const visited = new Uint8Array(SHEET.w * SHEET.h);
  const stack = new Int32Array(visited.length);
  let size = 0;
  const push = (pixel: number) => {
    if (visited[pixel]) return;
    visited[pixel] = 1;
    const i = pixel * 4;
    // Include the pale antialias fringe, not the surrounding outline.
    if (target.some((v, channel) => Math.abs(data[i + channel] - v) > 32)) return;
    stack[size++] = pixel;
  };
  push(seed);
  while (size) {
    const pixel = stack[--size];
    const i = pixel * 4;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
    if (pixel % SHEET.w > 0) push(pixel - 1);
    if (pixel % SHEET.w < SHEET.w - 1) push(pixel + 1);
    if (pixel >= SHEET.w) push(pixel - SHEET.w);
    if (pixel < visited.length - SHEET.w) push(pixel + SHEET.w);
  }
  ctx.putImageData(image, 0, 0);
}

// Keep the image before the last operation: extending a stroke or appending one
// must not replay every previous fill. Undo/reconnect still replay identically.
const cache = new WeakMap<CanvasRenderingContext2D, { strokes: Stroke[]; beforeLast?: ImageData }>();

export function paint(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  const previous = cache.get(ctx);
  let common = 0;
  if (previous) {
    while (common < Math.min(previous.strokes.length, strokes.length)) {
      const a = previous.strokes[common], b = strokes[common];
      if (a.c !== b.c || a.w !== b.w || a.p !== b.p || !!a.f !== !!b.f) break;
      common++;
    }
    if (common === strokes.length && common === previous.strokes.length) return;
  }
  let start = 0;
  if (previous && common === previous.strokes.length) {
    start = common;
  } else if (previous?.beforeLast && common === previous.strokes.length - 1) {
    ctx.putImageData(previous.beforeLast, 0, 0);
    start = common;
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SHEET.w, SHEET.h);
  }
  let beforeLast: ImageData | undefined;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const sx = SHEET.w / 1000;
  const sy = SHEET.h / 1000;
  for (let i = start; i < strokes.length; i++) {
    const s = strokes[i];
    if (i === strokes.length - 1) beforeLast = ctx.getImageData(0, 0, SHEET.w, SHEET.h);
    const pts = decode(s.p);
    if (!pts.length) continue;
    if (s.f) {
      fill(ctx, pts[0], s.c);
      continue;
    }
    ctx.strokeStyle = PALETTE[s.c] ?? PALETTE[0];
    ctx.lineWidth = WIDTHS[s.w] ?? WIDTHS[1];
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * sx, pts[0][1] * sy);
    // Un seul point : un trait de longueur nulle dessine un rond.
    if (pts.length === 1) ctx.lineTo(pts[0][0] * sx + 0.01, pts[0][1] * sy);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x * sx, y * sy);
    ctx.stroke();
  }
  cache.set(ctx, { strokes: strokes.map((s) => ({ ...s })), beforeLast });
}
