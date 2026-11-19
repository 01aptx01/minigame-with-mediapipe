export interface ReplayHudSnapshot {
  timeRemaining: number;
  p1Name: string;
  p1Score: number;
  p2Name?: string;
  p2Score?: number;
}

interface ReplayCanvas {
  canvas: HTMLCanvasElement;
  draw: () => void;
  setActive: (active: boolean) => void;
}

const MAX_EDGE = 640;
const HEADER_HEIGHT = 44;

export function createReplayCanvas(
  source: HTMLCanvasElement,
  getHud: () => ReplayHudSnapshot,
  fps: number,
): ReplayCanvas {
  const scale = Math.min(1, MAX_EDGE / Math.max(1, source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = HEADER_HEIGHT + Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Could not create the replay canvas.');

  const frameInterval = 1000 / fps;
  let frameId: number | null = null;
  let lastDrawAt = -Infinity;

  const draw = () => {
    const { width, height } = canvas;
    const stageHeight = height - HEADER_HEIGHT;
    const hud = getHud();
    const seconds = Math.max(0, Math.ceil(hud.timeRemaining));
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

    context.fillStyle = '#07090f';
    context.fillRect(0, 0, width, height);
    if (source.width > 0 && source.height > 0) {
      const fit = Math.min(width / source.width, stageHeight / source.height);
      const displayWidth = source.width * fit;
      const displayHeight = source.height * fit;
      context.drawImage(
        source,
        (width - displayWidth) / 2,
        HEADER_HEIGHT + (stageHeight - displayHeight) / 2,
        displayWidth,
        displayHeight,
      );
    }

    context.fillStyle = '#0d121e';
    context.fillRect(0, 0, width, HEADER_HEIGHT);
    context.fillStyle = '#334155';
    context.fillRect(0, HEADER_HEIGHT - 1, width, 1);
    context.textBaseline = 'middle';
    context.font = '700 13px system-ui, sans-serif';
    context.textAlign = 'left';
    context.fillStyle = '#67e8f9';
    context.fillText(`${hud.p1Name}  ${Math.round(hud.p1Score)}`, 10, 22, width * 0.31);
    context.textAlign = 'center';
    context.font = '700 16px ui-monospace, monospace';
    context.fillStyle = '#f1f5f9';
    context.fillText(clock, width / 2, 22, width * 0.25);
    if (hud.p2Name !== undefined && hud.p2Score !== undefined) {
      context.textAlign = 'right';
      context.font = '700 13px system-ui, sans-serif';
      context.fillStyle = '#fda4af';
      context.fillText(`${hud.p2Name}  ${Math.round(hud.p2Score)}`, width - 10, 22, width * 0.31);
    }
  };

  const tick = (now: number) => {
    frameId = requestAnimationFrame(tick);
    const elapsed = now - lastDrawAt;
    if (elapsed < frameInterval) return;
    draw();
    lastDrawAt = Number.isFinite(elapsed) ? now - (elapsed % frameInterval) : now;
  };

  const setActive = (active: boolean) => {
    if (active && frameId === null) {
      lastDrawAt = -Infinity;
      frameId = requestAnimationFrame(tick);
    } else if (!active && frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  };

  draw();
  return { canvas, draw, setActive };
}
