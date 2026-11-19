import { getSixSevenWrist, type SixSevenHit, type SixSevenLandmark } from './engine';

const SIX = '#00e5ff';
const SEVEN = '#ff5690';
export const SIX_SEVEN_HIT_MS = 440;

function colorFor(number: 6 | 7) {
  return number === 6 ? SIX : SEVEN;
}

function videoBounds(video: HTMLVideoElement | null, width: number, height: number) {
  const scale = video?.videoWidth && video.videoHeight
    ? Math.min(width / video.videoWidth, height / video.videoHeight)
    : 0;
  const w = scale && video ? video.videoWidth * scale : width;
  const h = scale && video ? video.videoHeight * scale : height;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

interface StageFrame {
  video: HTMLVideoElement | null;
  pose: readonly SixSevenLandmark[] | null;
  hits: readonly SixSevenHit[];
  nowMs: number;
  reducedMotion: boolean;
}

export function drawSixSevenStage(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  { video, pose, hits, nowMs, reducedMotion }: StageFrame
) {
  const bounds = videoBounds(video, width, height);
  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, width, height);

  if (video && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
    ctx.save();
    ctx.translate(bounds.x + bounds.w, bounds.y);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, bounds.w, bounds.h);
    ctx.restore();
  } else {
    const line = Math.max(20, Math.round(width / 19));
    ctx.strokeStyle = 'rgba(148, 163, 184, .1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = width / 2 % line; x < width; x += line) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = height / 2 % line; y < height; y += line) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(bounds.x, bounds.y, bounds.w, bounds.h);
  ctx.clip();
  const project = (point: Pick<SixSevenLandmark, 'x' | 'y'>) => ({
    x: bounds.x + (1 - point.x) * bounds.w,
    y: bounds.y + point.y * bounds.h,
  });

  if (pose) {
    for (const [side, color] of [['left', SIX], ['right', SEVEN]] as const) {
      const wrist = getSixSevenWrist(pose, side);
      if (!wrist) continue;
      const point = project(wrist);
      const radius = 11;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(9, 13, 22, .78)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  const size = Math.max(32, Math.min(64, width * 0.088));
  for (const hit of hits) {
    const age = Math.max(0, nowMs - hit.atMs);
    if (age >= SIX_SEVEN_HIT_MS) continue;
    const t = age / SIX_SEVEN_HIT_MS;
    const point = project(hit);
    const x = Math.max(bounds.x + size / 2, Math.min(bounds.x + bounds.w - size / 2, point.x));
    const y = Math.max(bounds.y + size / 2, point.y - size * (0.55 + (reducedMotion ? 0 : t)));
    const color = colorFor(hit.number);

    ctx.save();
    ctx.globalAlpha = reducedMotion ? 1 : 1 - t * t;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${size}px system-ui, sans-serif`;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = Math.max(3, size / 9);
    ctx.lineJoin = 'round';
    ctx.strokeText(String(hit.number), x, y);
    ctx.fillStyle = color;
    ctx.fillText(String(hit.number), x, y);
    ctx.font = `800 ${Math.max(11, size * .27)}px ui-monospace, monospace`;
    ctx.fillText('+1', x, y - size * .62);

    if (!reducedMotion) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let ray = 0; ray < 8; ray++) {
        const angle = ray * Math.PI / 4;
        const distance = size * (0.51 + t * 0.36);
        ctx.moveTo(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance);
        ctx.lineTo(x + Math.cos(angle) * (distance + 5), y + Math.sin(angle) * (distance + 5));
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

export function drawSixSevenClipHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  score: number,
  remainingSeconds: number,
  roundSeconds: number
) {
  ctx.fillStyle = '#0d121e';
  ctx.fillRect(0, 0, width, 52);
  ctx.fillRect(0, height - 5, width, 5);
  ctx.fillStyle = SIX;
  ctx.fillRect(0, height - 5, width * remainingSeconds / roundSeconds, 5);
  ctx.font = '900 18px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('SIX SEVEN', 18, 26);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 19px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.ceil(remainingSeconds)).padStart(2, '0') + 's', width / 2, 26);
  ctx.textAlign = 'right';
  ctx.fillText('SCORE  ' + score, width - 18, 26);
  ctx.textAlign = 'left';
}
