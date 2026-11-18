export type SixSevenClip = {
  id: string;
  createdAt: number;
  score: number;
  durationSeconds: number;
  blob: Blob;
};

export type SixSevenClipStoreResult = {
  clips: SixSevenClip[];
  persistent: boolean;
  removed?: boolean;
};

export const MAX_SIX_SEVEN_CLIPS = 5;
export const SIX_SEVEN_CAPTURE_FPS = 24;

const SEGMENT_ID = '18538067';
const INFO_ID = '1549a966';
const DURATION_ID = '4489';
const TRACKS_ID = '1654ae6b';
const CLUSTER_ID = '1f43b675';

const DATABASE_NAME = 'six-seven-replay-clips';
const DATABASE_VERSION = 1;
const STORE_NAME = 'clips';

let databasePromise: Promise<IDBDatabase> | null = null;
const memoryClips = new Map<string, SixSevenClip>();

function readElementIdLength(firstByte: number): number {
  for (let length = 1; length <= 4; length += 1) {
    if (firstByte >= 2 ** (8 - length)) return length;
  }
  return 0;
}

function readElementSize(bytes: Uint8Array, offset: number): {
  length: number;
  value: number;
  unknown: boolean;
} | null {
  const firstByte = bytes[offset];
  if (firstByte === undefined) return null;
  let length = 1;
  let marker = 0x80;
  while (length <= 8 && (firstByte & marker) === 0) {
    length += 1;
    marker >>= 1;
  }
  if (length > 8 || offset + length > bytes.length) return null;

  let value = firstByte & (marker - 1);
  let unknown = value === marker - 1;
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index];
    if (bytes[offset + index] !== 0xff) unknown = false;
  }
  return { length, value, unknown };
}

function readHex(bytes: Uint8Array, start: number, length: number): string {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += bytes[start + index].toString(16).padStart(2, '0');
  }
  return result;
}

function encodeElementSize(value: number, preferredLength: number): Uint8Array | null {
  for (let length = preferredLength; length <= 8; length += 1) {
    const marker = 2 ** (8 - length);
    const maxValue = 2 ** (7 * length) - 2;
    if (!Number.isSafeInteger(value) || value < 0 || value > maxValue) continue;
    const encoded = new Uint8Array(length);
    let remainder = value;
    for (let index = length - 1; index >= 0; index -= 1) {
      encoded[index] = remainder % 256;
      remainder = Math.floor(remainder / 256);
    }
    encoded[0] |= marker;
    return encoded;
  }
  return null;
}

function makeDurationElement(durationTicks: number): Uint8Array {
  const element = new Uint8Array(11);
  element[0] = 0x44;
  element[1] = 0x89;
  element[2] = 0x88;
  new DataView(element.buffer).setFloat64(3, durationTicks, false);
  return element;
}

function encodeUnsignedInteger(value: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let remainder = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = remainder % 256;
    remainder = Math.floor(remainder / 256);
  }
  return bytes;
}

/**
 * Add a finite WebM Duration element so local recordings expose a useful
 * duration and seek range in players that otherwise report Infinity.
 * If the container is unfamiliar, return the original blob unchanged.
 */
export async function addWebMDurationMetadata(
  blob: Blob,
  durationSeconds: number
): Promise<Blob> {
  if (!blob.type.toLowerCase().includes('webm') || !Number.isFinite(durationSeconds)) return blob;

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 16 || readHex(bytes, 0, 4) !== '1a45dfa3') return blob;
    let segmentStart = -1;
    let segmentSizeOffset = -1;
    let segmentSizeLength = 0;
    let segmentPayloadEnd = bytes.length;
    let infoStart = -1;
    let infoSizeOffset = -1;
    let infoSizeLength = 0;
    let infoPayloadStart = -1;
    let infoPayloadEnd = -1;
    let hasTracks = false;
    let hasCluster = false;

    for (let offset = 0; offset + 4 < bytes.length; ) {
      const idLength = readElementIdLength(bytes[offset]);
      if (idLength < 1 || offset + idLength >= bytes.length) break;
      const id = readHex(bytes, offset, idLength);
      const sizeOffset = offset + idLength;
      const size = readElementSize(bytes, sizeOffset);
      if (!size) break;
      const payloadStart = sizeOffset + size.length;
      const payloadEnd = size.unknown ? bytes.length : payloadStart + size.value;
      if (payloadEnd > bytes.length || payloadEnd < payloadStart) break;

      if (id === SEGMENT_ID) {
        segmentStart = offset;
        segmentSizeOffset = sizeOffset;
        segmentSizeLength = size.length;
        segmentPayloadEnd = payloadEnd;
        let childOffset = payloadStart;
        while (childOffset + 4 < segmentPayloadEnd) {
          const childIdLength = readElementIdLength(bytes[childOffset]);
          if (childIdLength < 1 || childOffset + childIdLength >= segmentPayloadEnd) break;
          const childId = readHex(bytes, childOffset, childIdLength);
          const childSizeOffset = childOffset + childIdLength;
          const childSize = readElementSize(bytes, childSizeOffset);
          if (!childSize) break;
          const childPayloadStart = childSizeOffset + childSize.length;
          const childPayloadEnd = childSize.unknown
            ? segmentPayloadEnd
            : childPayloadStart + childSize.value;
          if (childPayloadEnd > segmentPayloadEnd || childPayloadEnd < childPayloadStart) break;
          if (childId === INFO_ID) {
            if (childSize.unknown) break;
            infoStart = childOffset;
            infoSizeOffset = childSizeOffset;
            infoSizeLength = childSize.length;
            infoPayloadStart = childPayloadStart;
            infoPayloadEnd = childPayloadEnd;
          }
          if (childId === TRACKS_ID) hasTracks = true;
          if (childId === CLUSTER_ID) hasCluster = true;
          if (childSize.unknown || childPayloadEnd === childOffset) break;
          childOffset = childPayloadEnd;
        }
        break;
      }

      if (size.unknown || payloadEnd === offset) break;
      offset = payloadEnd;
    }

    if (
      segmentStart < 0 ||
      infoStart < 0 ||
      infoSizeOffset < 0 ||
      infoPayloadStart < 0 ||
      infoPayloadEnd < infoPayloadStart ||
      !hasTracks ||
      !hasCluster
    ) {
      return blob;
    }

    let timestampScale = 1_000_000;
    for (let offset = infoPayloadStart; offset + 1 < infoPayloadEnd; ) {
      const idLength = readElementIdLength(bytes[offset]);
      if (idLength < 1 || offset + idLength >= infoPayloadEnd) break;
      const id = readHex(bytes, offset, idLength);
      const sizeOffset = offset + idLength;
      const size = readElementSize(bytes, sizeOffset);
      if (!size || size.unknown) break;
      const payloadStart = sizeOffset + size.length;
      const payloadEnd = payloadStart + size.value;
      if (payloadEnd > infoPayloadEnd || payloadEnd < payloadStart) break;

      if (id === '2ad7b1' && size.value >= 1 && size.value <= 6) {
        timestampScale = 0;
        for (let index = payloadStart; index < payloadEnd; index += 1) {
          timestampScale = timestampScale * 256 + bytes[index];
        }
      }
      if (id === DURATION_ID && (size.value === 4 || size.value === 8)) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + payloadStart, size.value);
        if (size.value === 8) view.setFloat64(0, durationSeconds * 1_000_000_000 / timestampScale, false);
        else view.setFloat32(0, durationSeconds * 1_000_000_000 / timestampScale, false);
        return new Blob([bytes], { type: blob.type || 'video/webm' });
      }
      offset = payloadEnd;
    }

    const durationElement = makeDurationElement(
      (durationSeconds * 1_000_000_000) / timestampScale
    );
    const newInfoSize = infoPayloadEnd - infoPayloadStart + durationElement.length;
    const newInfoSizeBytes = encodeElementSize(newInfoSize, infoSizeLength);
    if (!newInfoSizeBytes) return blob;
    const infoSizeDelta = newInfoSizeBytes.length - infoSizeLength + durationElement.length;
    const segmentSize = readElementSize(bytes, segmentSizeOffset);
    let newSegmentSizeBytes: Uint8Array | null = null;
    if (segmentSize && !segmentSize.unknown) {
      newSegmentSizeBytes = encodeElementSize(segmentSize.value + infoSizeDelta, segmentSizeLength);
      if (!newSegmentSizeBytes || newSegmentSizeBytes.length !== segmentSizeLength) return blob;
    }

    const result = new Uint8Array(bytes.length + infoSizeDelta);
    const infoHeaderPrefixEnd = infoSizeOffset;
    const oldInfoHeaderEnd = infoPayloadStart;
    result.set(bytes.subarray(0, infoHeaderPrefixEnd), 0);
    let cursor = infoHeaderPrefixEnd;
    result.set(newInfoSizeBytes, cursor);
    cursor += newInfoSizeBytes.length;
    result.set(bytes.subarray(oldInfoHeaderEnd, infoPayloadEnd), cursor);
    cursor += infoPayloadEnd - oldInfoHeaderEnd;
    result.set(durationElement, cursor);
    cursor += durationElement.length;
    result.set(bytes.subarray(infoPayloadEnd), cursor);

    if (newSegmentSizeBytes) {
      result.set(newSegmentSizeBytes, segmentSizeOffset);
    }

    return new Blob([result], { type: blob.type || 'video/webm' });
  } catch {
    return blob;
  }
}

function newestFirst(clips: SixSevenClip[]): SixSevenClip[] {
  return clips.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

function bounded(clips: SixSevenClip[]): SixSevenClip[] {
  const unique = new Map<string, SixSevenClip>();
  for (const clip of newestFirst(clips)) {
    if (!unique.has(clip.id)) unique.set(clip.id, clip);
  }
  return [...unique.values()].slice(0, MAX_SIX_SEVEN_CLIPS);
}

function boundedMemoryClips(): SixSevenClip[] {
  const clips = bounded([...memoryClips.values()]);
  const keepIds = new Set(clips.map((clip) => clip.id));
  for (const id of memoryClips.keys()) {
    if (!keepIds.has(id)) memoryClips.delete(id);
  }
  return clips;
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(error);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open clip storage'));
    request.onblocked = () => reject(new Error('Clip storage is blocked'));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });

  return databasePromise!;
}

function readDatabaseClips(database: IDBDatabase): Promise<SixSevenClip[]> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, 'readonly');
    } catch (error) {
      reject(error);
      return;
    }

    let clips: SixSevenClip[] = [];
    const request = transaction.objectStore(STORE_NAME).getAll() as IDBRequest<SixSevenClip[]>;
    request.onsuccess = () => {
      clips = Array.isArray(request.result) ? request.result : [];
    };
    transaction.oncomplete = () => resolve(clips);
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not read clips'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Clip read was interrupted'));
  });
}

function writeClipAndTrim(database: IDBDatabase, clip: SixSevenClip): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, 'readwrite');
    } catch (error) {
      reject(error);
      return;
    }

    const store = transaction.objectStore(STORE_NAME);
    store.put(clip);
    const request = store.getAll() as IDBRequest<SixSevenClip[]>;
    request.onsuccess = () => {
      const allClips = Array.isArray(request.result) ? request.result : [];
      const keepIds = new Set(bounded(allClips).map((item) => item.id));
      for (const item of allClips) {
        if (!keepIds.has(item.id)) store.delete(item.id);
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save clip'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Clip save was interrupted'));
  });
}

function deleteDatabaseClip(database: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, 'readwrite');
    } catch (error) {
      reject(error);
      return;
    }

    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not remove clip'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Clip removal was interrupted'));
  });
}

async function collectClips(): Promise<{ clips: SixSevenClip[]; persistent: boolean }> {
  try {
    const database = await openDatabase();
    const persisted = await readDatabaseClips(database);
    const clips = bounded([...persisted, ...memoryClips.values()]);
    if (persisted.length > MAX_SIX_SEVEN_CLIPS) {
      const keepIds = new Set(bounded(persisted).map((clip) => clip.id));
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        for (const clip of persisted) {
          if (!keepIds.has(clip.id)) store.delete(clip.id);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Could not trim clip history'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Clip history trim was interrupted'));
      });
    }
    for (const clip of clips) {
      if (memoryClips.has(clip.id) && persisted.some((saved) => saved.id === clip.id)) {
        memoryClips.delete(clip.id);
      }
    }
    const keptIds = new Set(clips.map((clip) => clip.id));
    for (const id of memoryClips.keys()) {
      if (!keptIds.has(id)) memoryClips.delete(id);
    }
    return { clips, persistent: true };
  } catch {
    return { clips: boundedMemoryClips(), persistent: false };
  }
}

/** Read the device-local clip history, falling back to this page session if needed. */
export async function loadSixSevenClips(): Promise<SixSevenClipStoreResult> {
  const result = await collectClips();
  return { clips: result.clips, persistent: result.persistent };
}

/** Save one clip locally and keep at most the newest five clips. */
export async function saveSixSevenClip(clip: SixSevenClip): Promise<SixSevenClipStoreResult> {
  memoryClips.set(clip.id, clip);
  let persistent = false;
  try {
    const database = await openDatabase();
    await writeClipAndTrim(database, clip);
    persistent = true;
  } catch {
    // Keep the clip in memory for this page session if persistent storage fails.
  }

  const result = await collectClips();
  return { clips: result.clips, persistent };
}

/** Remove a clip from local storage and from the in-memory fallback. */
export async function removeSixSevenClip(id: string): Promise<SixSevenClipStoreResult> {
  const wasInMemory = memoryClips.has(id);
  memoryClips.delete(id);
  let databaseAvailable = false;
  let persistent = false;
  try {
    const database = await openDatabase();
    databaseAvailable = true;
    await deleteDatabaseClip(database, id);
    persistent = true;
  } catch {
    // The subsequent read decides whether the failed removal remains visible.
  }

  const result = await collectClips();
  const removed = persistent || (!databaseAvailable && wasInMemory);
  return {
    clips: result.clips,
    persistent,
    removed,
  };
}
