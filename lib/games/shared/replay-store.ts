export type LocalReplayClip = {
  id: string;
  createdAt: number;
  score: number;
  durationSeconds: number;
  blob: Blob;
};

export type ReplayStoreResult<TClip extends LocalReplayClip> = {
  clips: TClip[];
  persistent: boolean;
  removed?: boolean;
};

export const MAX_REPLAY_CLIPS = 5;

const DATABASE_VERSION = 1;
const STORE_NAME = 'clips';

const databasePromises = new Map<string, Promise<IDBDatabase>>();
const memoryClipsByDatabase = new Map<string, Map<string, LocalReplayClip>>();

function newestFirst<TClip extends LocalReplayClip>(clips: TClip[]): TClip[] {
  return clips.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

function bounded<TClip extends LocalReplayClip>(clips: TClip[], maxClips: number): TClip[] {
  const unique = new Map<string, TClip>();
  for (const clip of newestFirst(clips)) {
    if (!unique.has(clip.id)) unique.set(clip.id, clip);
  }
  return [...unique.values()].slice(0, maxClips);
}

function memoryClipsFor(databaseName: string): Map<string, LocalReplayClip> {
  let clips = memoryClipsByDatabase.get(databaseName);
  if (!clips) {
    clips = new Map<string, LocalReplayClip>();
    memoryClipsByDatabase.set(databaseName, clips);
  }
  return clips;
}

function boundedMemoryClips<TClip extends LocalReplayClip>(
  databaseName: string,
  maxClips: number,
): TClip[] {
  const memoryClips = memoryClipsFor(databaseName);
  const clips = bounded([...memoryClips.values()] as TClip[], maxClips);
  const keepIds = new Set(clips.map((clip) => clip.id));
  for (const id of memoryClips.keys()) {
    if (!keepIds.has(id)) memoryClips.delete(id);
  }
  return clips;
}

function openDatabase(databaseName: string): Promise<IDBDatabase> {
  const current = databasePromises.get(databaseName);
  if (current) return current;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(databaseName, DATABASE_VERSION);
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
    request.onerror = () => reject(request.error ?? new Error('Could not open replay storage'));
    request.onblocked = () => reject(new Error('Replay storage is blocked'));
  });

  databasePromises.set(databaseName, promise);
  void promise.catch(() => {
    if (databasePromises.get(databaseName) === promise) {
      databasePromises.delete(databaseName);
    }
  });
  return promise;
}

function readDatabaseClips<TClip extends LocalReplayClip>(
  database: IDBDatabase,
): Promise<TClip[]> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, 'readonly');
    } catch (error) {
      reject(error);
      return;
    }

    let clips: TClip[] = [];
    const request = transaction.objectStore(STORE_NAME).getAll() as IDBRequest<TClip[]>;
    request.onsuccess = () => {
      clips = Array.isArray(request.result) ? request.result : [];
    };
    transaction.oncomplete = () => resolve(clips);
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not read replays'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Replay read was interrupted'));
  });
}

function writeClipAndTrim<TClip extends LocalReplayClip>(
  database: IDBDatabase,
  clip: TClip,
  maxClips: number,
): Promise<void> {
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
    const request = store.getAll() as IDBRequest<TClip[]>;
    request.onsuccess = () => {
      const allClips = Array.isArray(request.result) ? request.result : [];
      const keepIds = new Set(bounded(allClips, maxClips).map((item) => item.id));
      for (const item of allClips) {
        if (!keepIds.has(item.id)) store.delete(item.id);
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save replay'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Replay save was interrupted'));
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
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not remove replay'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Replay removal was interrupted'));
  });
}

async function trimDatabaseClips<TClip extends LocalReplayClip>(
  database: IDBDatabase,
  clips: TClip[],
  maxClips: number,
): Promise<void> {
  if (clips.length <= maxClips) return;
  const keepIds = new Set(bounded(clips, maxClips).map((clip) => clip.id));
  await new Promise<void>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, 'readwrite');
    } catch (error) {
      reject(error);
      return;
    }
    const store = transaction.objectStore(STORE_NAME);
    for (const clip of clips) {
      if (!keepIds.has(clip.id)) store.delete(clip.id);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not trim replay history'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Replay history trim was interrupted'));
  });
}

async function collectClips<TClip extends LocalReplayClip>(
  databaseName: string,
  maxClips: number,
): Promise<{ clips: TClip[]; persistent: boolean }> {
  const memoryClips = memoryClipsFor(databaseName);
  try {
    const database = await openDatabase(databaseName);
    const persisted = await readDatabaseClips<TClip>(database);
    const clips = bounded([...persisted, ...memoryClips.values()] as TClip[], maxClips);
    await trimDatabaseClips(database, persisted, maxClips);

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
    return { clips: boundedMemoryClips<TClip>(databaseName, maxClips), persistent: false };
  }
}

/** Read device-local replay history, falling back to this page session if needed. */
export async function loadReplayClips<TClip extends LocalReplayClip>(
  databaseName: string,
  maxClips = MAX_REPLAY_CLIPS,
): Promise<ReplayStoreResult<TClip>> {
  const result = await collectClips<TClip>(databaseName, maxClips);
  return { clips: result.clips, persistent: result.persistent };
}

/** Save one replay locally while keeping only the newest configured clips. */
export async function saveReplayClip<TClip extends LocalReplayClip>(
  databaseName: string,
  clip: TClip,
  maxClips = MAX_REPLAY_CLIPS,
): Promise<ReplayStoreResult<TClip>> {
  memoryClipsFor(databaseName).set(clip.id, clip);
  let persistent = false;
  try {
    const database = await openDatabase(databaseName);
    await writeClipAndTrim(database, clip, maxClips);
    persistent = true;
  } catch {
    // Keep a bounded in-memory copy for this page session if storage is unavailable.
  }

  const result = await collectClips<TClip>(databaseName, maxClips);
  return { clips: result.clips, persistent };
}

/** Remove a replay from device storage and from the in-memory fallback. */
export async function removeReplayClip<TClip extends LocalReplayClip>(
  databaseName: string,
  id: string,
  maxClips = MAX_REPLAY_CLIPS,
): Promise<ReplayStoreResult<TClip>> {
  const memoryClips = memoryClipsFor(databaseName);
  const wasInMemory = memoryClips.has(id);
  memoryClips.delete(id);
  let databaseAvailable = false;
  let persistent = false;
  try {
    const database = await openDatabase(databaseName);
    databaseAvailable = true;
    await deleteDatabaseClip(database, id);
    persistent = true;
  } catch {
    // The subsequent read decides whether a failed removal remains visible.
  }

  const result = await collectClips<TClip>(databaseName, maxClips);
  return {
    clips: result.clips,
    persistent,
    removed: persistent || (!databaseAvailable && wasInMemory),
  };
}
