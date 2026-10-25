// MODULE: small UI actions (theme switch, toast, victory confetti overlay) | USED BY: main.ts

export function toggleTheme(): void {
  const root = document.documentElement;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch (e) { /* storage may be blocked */ }
}

let toastTimer: number | undefined;

// Replaces alert(): a quiet message at the bottom of the screen.
export function showToast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { if (el) el.style.display = 'none'; }, 3200);
}

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  shape: 'rect' | 'hex' | 'circle';
  angle: number;
  vAngle: number;
  tilt: number;
  vTilt: number;
  alpha: number;
  decay: number;
}

let confettiRafId = 0;

export function clearVictoryConfetti(): void {
  if (confettiRafId) {
    cancelAnimationFrame(confettiRafId);
    confettiRafId = 0;
  }
  document.getElementById('confettiOverlay')?.remove();
}

export function triggerVictoryConfetti(winnerColor?: string): void {
  clearVictoryConfetti();
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'confettiOverlay';
  canvas.className = 'confetti-overlay';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();

  const palette = [
    winnerColor || '#d9893b',
    '#d9893b', // Accent amber
    '#e2c56b', // Wheat gold
    '#a9c27a', // Meadow green
    '#5f8a5a', // Forest pine
    '#c0674a', // Clay brick
    '#6ca6c4', // Harbor blue
    '#f4f1ea'  // Warm cream
  ];

  const shapes: ConfettiPiece['shape'][] = ['rect', 'rect', 'hex', 'circle'];
  const pieces: ConfettiPiece[] = [];

  const spawnBurst = (originX: number, originY: number, count: number, spreadRad: number, baseAngle: number, speedMult = 1) => {
    for (let i = 0; i < count; i++) {
      const a = baseAngle + (Math.random() - 0.5) * spreadRad;
      const speed = (9 + Math.random() * 15) * speedMult;
      pieces.push({
        x: originX + (Math.random() - 0.5) * 36,
        y: originY + (Math.random() - 0.5) * 24,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 2,
        w: 7 + Math.random() * 7,
        h: 5 + Math.random() * 6,
        color: palette[i % palette.length],
        shape: shapes[i % shapes.length],
        angle: Math.random() * Math.PI * 2,
        vAngle: (Math.random() - 0.5) * 0.16,
        tilt: Math.random() * Math.PI * 2,
        vTilt: 0.08 + Math.random() * 0.14,
        alpha: 1,
        decay: 0.0032 + Math.random() * 0.0028
      });
    }
  };

  const W = canvas.width;
  const H = canvas.height;
  // Left & right side cannons + top center shower when VP threshold is reached
  spawnBurst(W * 0.14, H * 0.72, 65, 0.9, -Math.PI * 0.36, 1.15);
  spawnBurst(W * 0.86, H * 0.72, 65, 0.9, -Math.PI * 0.64, 1.15);
  spawnBurst(W * 0.5, H * 0.18, 55, Math.PI * 1.2, -Math.PI * 0.5, 0.85);

  const startTime = performance.now();
  let secondWaveSpawned = false;

  const drawHex = (r: number) => {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const th = (Math.PI / 3) * k;
      const px = Math.cos(th) * r;
      const py = Math.sin(th) * r;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  };

  const tick = (now: number) => {
    const elapsed = now - startTime;
    if (!secondWaveSpawned && elapsed > 380) {
      secondWaveSpawned = true;
      spawnBurst(canvas.width * 0.3, canvas.height * 0.25, 40, Math.PI, -Math.PI * 0.5, 0.8);
      spawnBurst(canvas.width * 0.7, canvas.height * 0.25, 40, Math.PI, -Math.PI * 0.5, 0.8);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let alive = 0;
    for (const p of pieces) {
      if (p.alpha <= 0.02 || p.y > canvas.height + 40) continue;
      alive++;

      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.28; // gravity
      p.angle += p.vAngle;
      p.tilt += p.vTilt;
      if (elapsed > 2200) p.alpha = Math.max(0, p.alpha - p.decay * 1.8);

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.scale(1, Math.cos(p.tilt));
      ctx.fillStyle = p.color;

      if (p.shape === 'hex') {
        drawHex(p.w * 0.55);
      } else if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.w * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }

    if (alive > 0 && elapsed < 5200) {
      confettiRafId = requestAnimationFrame(tick);
    } else {
      clearVictoryConfetti();
    }
  };

  confettiRafId = requestAnimationFrame(tick);
}

