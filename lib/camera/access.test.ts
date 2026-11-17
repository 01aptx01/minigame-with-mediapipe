import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraErrorMessage, createCameraRequestGate, requestWebcam } from './access';

test('camera can retry after an immediate unsupported/policy failure', async () => {
  const request = createCameraRequestGate();
  assert.equal(await request(async () => false), false);
  let attempts = 0;
  assert.equal(await request(async () => { attempts++; return true; }), true);
  assert.equal(attempts, 1);
});

test('repeated clicks share a pending permission request and a rejection releases it', async () => {
  const request = createCameraRequestGate();
  let rejectPermission!: (reason: Error) => void;
  const first = request(() => new Promise((_, reject) => { rejectPermission = reject; }));
  const second = request(async () => { throw new Error('duplicate prompt'); });
  assert.equal(first, second);
  const rejected = assert.rejects(first, /denied/);
  rejectPermission(new Error('denied'));
  await rejected;
  assert.equal(await request(async () => true), true);
});

test('webcam requests video without microphone access', async () => {
  const stream = { getTracks: () => [] } as unknown as MediaStream;
  const devices = { getUserMedia: async (constraints: MediaStreamConstraints) => {
    assert.equal(constraints.audio, false);
    assert.equal(typeof constraints.video, 'object');
    return stream;
  }};
  assert.equal(await requestWebcam(devices), stream);
});

test('ignored permission prompts time out, and a late camera stream is stopped', async () => {
  let resolveCamera!: (stream: MediaStream) => void;
  let stopped = 0;
  const devices = { getUserMedia: () => new Promise<MediaStream>((resolve) => { resolveCamera = resolve; }) };
  await assert.rejects(requestWebcam(devices, 5), { name: 'TimeoutError' });
  resolveCamera({ getTracks: () => [{ stop: () => { stopped++; } }] } as unknown as MediaStream);
  await Promise.resolve();
  assert.equal(stopped, 1);
});

test('camera failures distinguish blocked previews, denied permission, missing and busy hardware', () => {
  const error = (name: string) => new DOMException('', name);
  assert.match(cameraErrorMessage(error('NotAllowedError'), true), /full page/);
  assert.match(cameraErrorMessage(error('NotAllowedError'), false), /browser permissions/);
  assert.match(cameraErrorMessage(error('NotFoundError'), false), /No camera/);
  assert.match(cameraErrorMessage(error('NotReadableError'), false), /other apps/);
});
