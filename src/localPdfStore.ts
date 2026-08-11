export type StoredLocalPdf = {
  paperId: string;
  blob: Blob;
  name: string;
  size: number;
  addedAt: string;
};

const DB_NAME = "chronicle-reading-room";
const STORE_NAME = "paper-pdfs";
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "paperId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB could not be opened"));
  });
}

export async function saveLocalPdf(paperId: string, file: File): Promise<StoredLocalPdf> {
  const record: StoredLocalPdf = { paperId, blob: file, name: file.name, size: file.size, addedAt: new Date().toISOString() };
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Local PDF could not be stored"));
  });
  database.close();
  return record;
}

export async function loadLocalPdf(paperId: string): Promise<StoredLocalPdf | null> {
  const database = await openDatabase();
  const record = await new Promise<StoredLocalPdf | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(paperId);
    request.onsuccess = () => resolve(request.result as StoredLocalPdf | undefined);
    request.onerror = () => reject(request.error || new Error("Local PDF could not be read"));
  });
  database.close();
  return record || null;
}

export async function removeLocalPdf(paperId: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(paperId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Local PDF could not be removed"));
  });
  database.close();
}
