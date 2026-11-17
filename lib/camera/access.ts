/** Share one permission prompt, and release it after every result (including early failures). */
export function createCameraRequestGate() {
  let pending: Promise<boolean> | null = null;
  return (request: () => Promise<boolean>): Promise<boolean> => {
    if (pending) return pending;
    // Invoke immediately, so getUserMedia remains inside the button's user gesture.
    const task = request();
    const tracked = task.finally(() => {
      if (pending === tracked) pending = null;
    });
    pending = tracked;
    return tracked;
  };
}

/** A dismissed/ignored browser prompt must not leave the UI waiting indefinitely. */
export function requestWebcam(
  mediaDevices: Pick<MediaDevices, 'getUserMedia'>,
  timeoutMs = 20000
): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new DOMException('Camera permission request timed out.', 'TimeoutError'));
    }, timeoutMs);
    mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    }).then((stream) => {
      if (settled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(stream);
    }, (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Browser video playback can remain pending even after camera permission succeeds. */
export function playWebcamVideo(
  video: Pick<HTMLVideoElement, 'play'>,
  timeoutMs = 10000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DOMException('Camera video did not start in time.', 'CameraPlaybackTimeoutError'));
    }, timeoutMs);
    try {
      Promise.resolve(video.play()).then(() => {
        clearTimeout(timer);
        resolve();
      }, () => {
        clearTimeout(timer);
        reject(new DOMException('The browser could not play the camera video.', 'CameraPlaybackError'));
      });
    } catch {
      clearTimeout(timer);
      reject(new DOMException('The browser could not play the camera video.', 'CameraPlaybackError'));
    }
  });
}

export function cameraErrorMessage(error: unknown, embedded: boolean): string {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return embedded
        ? 'This preview may block camera permission. Open the full page, then allow camera access.'
        : 'Camera access is blocked. Allow Camera in this site’s browser permissions, then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found. Connect or enable a webcam, then try again.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera could not start. Close other apps using it and check your device’s camera privacy settings.';
    case 'CameraPlaybackTimeoutError':
      return 'Camera permission was granted, but the video did not start. Close other camera apps and try again, or open the full page in another browser.';
    case 'CameraPlaybackError':
      return 'Camera permission was granted, but this browser could not play the video. Try Enable Webcam again or open the full page in another browser.';
    case 'TimeoutError':
      return 'Still waiting for permission. Check the browser’s camera prompt, allow access, then try again.';
    case 'SecurityError':
      return 'Camera access is disabled in this browser context. Open the full page in Chrome or Safari.';
    case 'OverconstrainedError':
      return 'This camera does not support the requested video settings. Try another webcam or browser.';
    default:
      return 'The camera could not start. Open the full page in Chrome or Safari and try again.';
  }
}
