import { drawCalibrationGrid } from '@/lib/games/shared/canvas';
import type { SixSevenHit, SixSevenNumber } from '@/lib/games/six-seven/engine';

export interface SixSevenStageHit extends SixSevenHit {
  id: number;
}

const HIT_POPUP_MS = 900;

export function promptForSixSeven(number: SixSevenNumber): string {
  return number === 6 ? 'LEFT UP · RIGHT DOWN' : 'RIGHT UP · LEFT DOWN';
}

/** Draw the same contained, mirrored video view used to place hand feedback. */
export function drawSixSevenVideo(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  width: number,
  height: number
): boolean {
  ctx.fillStyle = '#07090F';
  ctx.fillRect(0, 0, width, height);

  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    drawCalibrationGrid(ctx, width, height, 54, 'rgba(148,163,184,0.07)');
    return false;
  }

  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  const drawWidth = video.videoWidth * scale;
  const drawHeight = video.videoHeight * scale;
  const offsetX = (width - drawWidth) * 0.5;
  const offsetY = (height - drawHeight) * 0.5;

  ctx.save();
  ctx.globalAlpha = 0.44;
  ctx.translate(offsetX + drawWidth, offsetY);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, drawWidth, drawHeight);
  ctx.restore();

  // Subtle legibility wash; the camera remains visible across the contained frame.
  const wash = ctx.createLinearGradient(0, 0, 0, height);
  wash.addColorStop(0, 'rgba(7,9,15,0.08)');
  wash.addColorStop(1, 'rgba(7,9,15,0.22)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);
  return true;
}

export function projectSixSevenPoint(
  x: number,
  y: number,
  video: HTMLVideoElement | null,
  width: number,
  height: number
) {
  if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
    return { x: (1 - x) * width, y: y * height };
  }
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  const drawWidth = video.videoWidth * scale;
  const drawHeight = video.videoHeight * scale;
  const offsetX = (width - drawWidth) * 0.5;
  const offsetY = (height - drawHeight) * 0.5;
  return {
    x: offsetX + (1 - x) * drawWidth,
    y: offsetY + y * drawHeight,
  };
}

export function drawSixSevenStage(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  nowMs: number,
  nextNumber: SixSevenNumber,
  reduceMotion: boolean,
  video: HTMLVideoElement | null,
  hits: SixSevenStageHit[]
): void {
  const normalizedWidth = Math.max(1, width);
  const drift = reduceMotion ? 0 : Math.sin(nowMs * 0.00045) * 0.025;
  const leftGradient = ctx.createRadialGradient(
    width * 0.18,
    height * 0.43,
    8,
    width * 0.18,
    height * 0.43,
    width * 0.46
  );
  leftGradient.addColorStop(0, `rgba(0,229,255,${0.105 + drift})`);
  leftGradient.addColorStop(1, 'rgba(0,229,255,0)');
  ctx.fillStyle = leftGradient;
  ctx.fillRect(0, 0, width, height);

  const rightGradient = ctx.createRadialGradient(
    width * 0.82,
    height * 0.43,
    8,
    width * 0.82,
    height * 0.43,
    width * 0.46
  );
  rightGradient.addColorStop(0, `rgba(255,42,109,${0.095 + drift})`);
  rightGradient.addColorStop(1, 'rgba(255,42,109,0)');
  ctx.fillStyle = rightGradient;
  ctx.fillRect(0, 0, width, height);

  const activeText = promptForSixSeven(nextNumber);
  const promptY = Math.max(116, Math.min(height * 0.25, height - 110));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowBlur = reduceMotion ? 0 : 10;
  ctx.shadowColor = nextNumber === 6 ? '#00E5FF' : '#FF2A6D';
  ctx.fillStyle = nextNumber === 6 ? '#B6FBFF' : '#FFD0DF';
  ctx.font = `900 ${Math.max(12, Math.min(17, normalizedWidth * 0.045))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillText(activeText, width * 0.5, promptY);
  ctx.shadowBlur = 0;
  ctx.restore();

  // The 6 target stays on screen-left and the 7 target on screen-right.
  const compact = height < 360;
  const targetY = compact ? Math.max(108, height * 0.51) : Math.max(168, Math.min(height - 110, height * 0.69));
  const leftX = width * 0.3;
  const rightX = width * 0.7;
  const targetRadius = compact
    ? Math.max(23, Math.min(31, normalizedWidth * 0.085))
    : Math.max(27, Math.min(56, normalizedWidth * 0.105));

  for (const target of [
    { number: 6 as const, side: 'left' as const, x: leftX, color: '#66F6FF' },
    { number: 7 as const, side: 'right' as const, x: rightX, color: '#FF72A8' },
  ]) {
    const expected = nextNumber === target.number;
    const radius = targetRadius * (expected ? 1 : 0.88);
    const alpha = expected ? 0.96 : 0.35;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowBlur = expected && !reduceMotion ? 17 : 0;
    ctx.shadowColor = target.color;
    ctx.fillStyle = expected ? 'rgba(7,9,15,0.56)' : 'rgba(7,9,15,0.28)';
    ctx.strokeStyle = target.color;
    ctx.lineWidth = expected ? 3 : 2;
    ctx.beginPath();
    ctx.arc(target.x, targetY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = target.color;
    ctx.font = `900 ${radius * 1.12}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(target.number), target.x, targetY);
    ctx.fillStyle = '#F8FAFC';
    ctx.font = `800 ${compact ? 7 : 10}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillText(target.side === 'left' ? 'LEFT' : 'RIGHT', target.x, targetY + radius * 0.67);
    if (!compact) {
      ctx.fillStyle = expected ? target.color : 'rgba(226,232,240,0.62)';
      ctx.font = '700 9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(expected ? 'RAISE NOW' : 'WAIT', target.x, targetY + radius + 23);
    }
    ctx.restore();
  }

  const visibleHits: SixSevenStageHit[] = [];
  for (const hit of hits) {
    const age = Math.max(0, nowMs - hit.atMs);
    if (age >= HIT_POPUP_MS) continue;
    visibleHits.push(hit);
    const point = projectSixSevenPoint(hit.x, hit.y, video, width, height);
    const t = age / HIT_POPUP_MS;
    const alpha = reduceMotion ? 1 : 1 - t;
    const lift = reduceMotion ? 0 : t * 38;
    const color = hit.number === 6 ? '#66F6FF' : '#FF72A8';
    const radius = Math.max(24, Math.min(34, normalizedWidth * 0.06));

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowBlur = reduceMotion ? 0 : 16;
    ctx.shadowColor = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y - lift, radius + (reduceMotion ? 0 : t * 12), 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.font = `900 ${Math.max(20, radius * 0.9)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(`+1 · ${hit.number}`, point.x, point.y - lift - radius - 12);

    if (!reduceMotion) {
      for (let spark = 0; spark < 6; spark++) {
        const angle = (spark / 6) * Math.PI * 2;
        const distance = radius + 6 + t * 20;
        ctx.globalAlpha = alpha * 0.85;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(point.x + Math.cos(angle) * distance, point.y - lift + Math.sin(angle) * distance, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  hits.splice(0, hits.length, ...visibleHits);
}
