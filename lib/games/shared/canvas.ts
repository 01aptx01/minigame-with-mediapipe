export interface ParticleBurstItem {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface ParticlePool {
  items: ParticleBurstItem[];
  cursor: number;
}

export function createParticlePool(size: number): ParticlePool {
  return {
    items: Array.from({ length: size }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 3,
      color: '#00E5FF',
      life: 0,
      maxLife: 0.4,
    })),
    cursor: 0,
  };
}

export function resetParticlePool(pool: ParticlePool): void {
  for (let i = 0; i < pool.items.length; i++) {
    pool.items[i].active = false;
  }
  pool.cursor = 0;
}

export function spawnParticleBurst(
  pool: ParticlePool,
  x: number,
  y: number,
  color: string,
  count: number,
  speedMin: number = 110,
  speedRange: number = 300
): void {
  const len = pool.items.length;
  for (let i = 0; i < count; i++) {
    const p = pool.items[pool.cursor];
    pool.cursor = (pool.cursor + 1) % len;

    const angle = Math.random() * Math.PI * 2;
    const speed = speedMin + Math.random() * speedRange;
    p.active = true;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed - 50;
    p.size = 2.5 + Math.random() * 4.5;
    p.color = color;
    p.life = 0;
    p.maxLife = 0.3 + Math.random() * 0.25;
  }
}

export function updateAndDrawParticles(
  ctx: CanvasRenderingContext2D,
  pool: ParticlePool,
  dt: number,
  gravity: number = 380
): void {
  const items = pool.items;
  ctx.save();
  let lastColor = '';

  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    if (!p.active) continue;

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += gravity * dt;
    p.life += dt;

    if (p.life >= p.maxLife) {
      p.active = false;
      continue;
    }

    ctx.globalAlpha = Math.max(0, 1 - p.life / p.maxLife);
    if (p.color !== lastColor) {
      ctx.fillStyle = p.color;
      lastColor = p.color;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawMirroredVideoCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
  alpha: number = 0.36
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(width, 0);
  ctx.scale(-1, 1);

  const videoAspect = video.videoWidth / video.videoHeight;
  const canvasAspect = width / height;
  let drawW = width;
  let drawH = height;
  let drawX = 0;
  let drawY = 0;

  if (canvasAspect > videoAspect) {
    drawH = width / videoAspect;
    drawY = (height - drawH) * 0.5;
  } else {
    drawW = height * videoAspect;
    drawX = (width - drawW) * 0.5;
  }

  ctx.drawImage(video, drawX, drawY, drawW, drawH);
  ctx.restore();
}

export function drawCalibrationGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  step: number = 64,
  strokeStyle: string = 'rgba(148, 163, 184, 0.06)'
): void {
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = 0; gx <= width; gx += step) {
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, height);
  }
  for (let gy = 0; gy <= height; gy += step) {
    ctx.moveTo(0, gy);
    ctx.lineTo(width, gy);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawSplitDivider(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  topOffset: number = 68
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(width * 0.5, topOffset);
  ctx.lineTo(width * 0.5, height);
  ctx.stroke();
  ctx.restore();
}

export function drawArenaBackdrop(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  width: number,
  height: number,
  options?: {
    background?: string;
    videoAlpha?: number;
    gridStep?: number;
    gridStroke?: string;
  }
): boolean {
  const bg = options?.background ?? '#07090F';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  if (video && video.readyState >= 2 && video.videoWidth > 0) {
    drawMirroredVideoCover(ctx, video, width, height, options?.videoAlpha ?? 0.36);
    return true;
  }

  drawCalibrationGrid(
    ctx,
    width,
    height,
    options?.gridStep ?? 64,
    options?.gridStroke ?? 'rgba(148, 163, 184, 0.06)'
  );
  return false;
}
