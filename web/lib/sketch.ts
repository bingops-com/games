// Un dessin est une liste de traits sur une feuille de 1000 sur 1000 (la page l'étire à
// sa forme). Les points voyagent en texte : deux chiffres en base 36 pour x, deux pour y.
export interface Stroke {
  c: number;
  w: number;
  p: string;
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

export function paint(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SHEET.w, SHEET.h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const sx = SHEET.w / 1000;
  const sy = SHEET.h / 1000;
  for (const s of strokes) {
    const pts = decode(s.p);
    if (!pts.length) continue;
    ctx.strokeStyle = PALETTE[s.c] ?? PALETTE[0];
    ctx.lineWidth = WIDTHS[s.w] ?? WIDTHS[1];
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * sx, pts[0][1] * sy);
    // Un seul point : un trait de longueur nulle dessine un rond.
    if (pts.length === 1) ctx.lineTo(pts[0][0] * sx + 0.01, pts[0][1] * sy);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x * sx, y * sy);
    ctx.stroke();
  }
}
