// MODULE: lobby cursors and laser pointer (non-hosts cannot edit the map, they point at it instead) | DEPENDS ON: client/socket, client/store | USED BY: client/main
// Cursor positions are sent in board (SVG) coordinates, so they line up for everyone whatever their pan and zoom.
// Hold Shift while moving the mouse to leave a short glowing laser trail.
import { socket } from './socket';
import { isPanning, state } from './store';

interface TrailPoint { x: number; y: number; t: number }
interface RemoteCursor { x: number; y: number; laser: boolean; seen: number; trail: TrailPoint[] }

const TRAIL_MS = 900;
const IDLE_MS = 4000;
const SEND_EVERY_MS = 40;

const cursors = new Map<string, RemoteCursor>();
let canvas: HTMLCanvasElement | null = null;
let frame = 0;
let lastSent = 0;

function boardSvg(): SVGSVGElement | null {
  return document.getElementById('boardSvg') as unknown as SVGSVGElement | null;
}

function clientToWorld(cx: number, cy: number): { x: number; y: number } | null {
  const svg = boardSvg();
  const ctm = svg?.getScreenCTM();
  if (!svg || !ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = cx;
  pt.y = cy;
  const w = pt.matrixTransform(ctm.inverse());
  return { x: w.x, y: w.y };
}

function worldToClient(x: number, y: number): { x: number; y: number } | null {
  const svg = boardSvg();
  const ctm = svg?.getScreenCTM();
  if (!svg || !ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = x;
  pt.y = y;
  const s = pt.matrixTransform(ctm);
  return { x: s.x, y: s.y };
}

function ensureCanvas(stage: HTMLElement): HTMLCanvasElement {
  if (canvas && canvas.parentElement === stage) return canvas;
  canvas = document.createElement('canvas');
  canvas.id = 'cursorLayer';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6';
  if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
  stage.appendChild(canvas);
  return canvas;
}

function kick(): void {
  if (!frame) frame = requestAnimationFrame(draw);
}

function pointer(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, label: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 17);
  ctx.lineTo(4.6, 13);
  ctx.lineTo(8, 20);
  ctx.lineTo(10.6, 18.8);
  ctx.lineTo(7.2, 12);
  ctx.lineTo(12.6, 12);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fill();

  ctx.font = '600 11px system-ui, sans-serif';
  const w = ctx.measureText(label).width + 12;
  ctx.fillStyle = color;
  ctx.beginPath();
  const bx = 12, by = 18, bh = 18, r = 9;
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + w - r, by);
  ctx.arc(bx + w - r, by + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(bx + r, by + bh);
  ctx.arc(bx + r, by + r, r, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 18, 27.5);
  ctx.restore();
}

function draw(): void {
  frame = 0;
  const stage = document.getElementById('boardStage');
  if (!stage) return;
  const cv = ensureCanvas(stage);
  const dpr = window.devicePixelRatio || 1;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Pointing only exists in the lobby.
  if (!state || state.status !== 'LOBBY') {
    cursors.clear();
    return;
  }

  const rect = stage.getBoundingClientRect();
  const now = performance.now();
  let active = false;

  for (const [id, c] of cursors) {
    c.trail = c.trail.filter(p => now - p.t < TRAIL_MS);
    const idle = now - c.seen > IDLE_MS;
    if (idle && c.trail.length === 0) {
      cursors.delete(id);
      continue;
    }
    active = true;
    const who = state.players.find(p => p.id === id) || (state.spectators || []).find(s => s.id === id);
    const color = who?.color || '#888';

    if (c.trail.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = color;
      for (let i = 1; i < c.trail.length; i++) {
        const a = worldToClient(c.trail[i - 1].x, c.trail[i - 1].y);
        const b = worldToClient(c.trail[i].x, c.trail[i].y);
        if (!a || !b) continue;
        ctx.globalAlpha = Math.max(0, 1 - (now - c.trail[i].t) / TRAIL_MS);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(a.x - rect.left, a.y - rect.top);
        ctx.lineTo(b.x - rect.left, b.y - rect.top);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Your own pointer is the real mouse cursor; only the others get a drawn one.
    if (!idle && id !== socket.id) {
      const p = worldToClient(c.x, c.y);
      if (p) {
        if (c.laser) {
          ctx.save();
          ctx.shadowColor = color;
          ctx.shadowBlur = 16;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x - rect.left, p.y - rect.top, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        pointer(ctx, p.x - rect.left, p.y - rect.top, color, who?.name || 'Player');
      }
    }
  }

  if (active) kick();
}

function applyCursor(id: string, x: number, y: number, laser: boolean): void {
  const now = performance.now();
  let c = cursors.get(id);
  if (!c) {
    c = { x, y, laser, seen: now, trail: [] };
    cursors.set(id, c);
  }
  c.x = x;
  c.y = y;
  c.laser = laser;
  c.seen = now;
  if (laser) c.trail.push({ x, y, t: now });
  kick();
}

export function initCursors(): void {
  const stage = document.getElementById('boardStage');
  if (!stage) return;

  stage.addEventListener('mousemove', (e: MouseEvent) => {
    if (isPanning || !state || state.status !== 'LOBBY') return;
    const w = clientToWorld(e.clientX, e.clientY);
    if (!w) return;
    const laser = e.shiftKey;
    if (laser) applyCursor(socket.id, w.x, w.y, true); // local trail, so your own laser shows too
    const now = performance.now();
    if (now - lastSent < SEND_EVERY_MS) return;
    lastSent = now;
    socket.emit('cursor', { code: state.code, x: Math.round(w.x * 10) / 10, y: Math.round(w.y * 10) / 10, laser });
  });

  stage.addEventListener('mouseleave', () => {
    if (state?.status === 'LOBBY') socket.emit('cursor', { code: state.code, hide: true });
  });

  socket.on('cursor', (m: any) => {
    if (!m || !m.id) return;
    if (m.hide) {
      const c = cursors.get(m.id);
      if (c) c.seen = 0; // goes idle: pointer disappears, any trail fades out
      kick();
      return;
    }
    if (Number.isFinite(m.x) && Number.isFinite(m.y)) applyCursor(m.id, m.x, m.y, !!m.laser);
  });
}
