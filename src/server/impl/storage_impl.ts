import {
  FileMetadata,
  StorageActionWriter,
  StorageId,
  StorageReader,
  StorageWriter,
} from "../storage.js";
import { version } from "../../index.js";
import { performAsyncSyscall, performJsSyscall } from "./syscall.js";
import { validateArg } from "./validate.js";

export function setupStorageReader(requestId: string): StorageReader {
  return {
    getUrl: async (storageId: StorageId) => {
      validateArg(storageId, 1, "getUrl", "storageId");
      return await performAsyncSyscall("storageGetUrl", {
        requestId,
        version,
        storageId,
      });
    },
    getMetadata: async (storageId: StorageId): Promise<FileMetadata> => {
      return await performAsyncSyscall("storageGetMetadata", {
        requestId,
        version,
        storageId,
      });
    },
  };
}

export function setupStorageWriter(requestId: string): StorageWriter {
  const reader = setupStorageReader(requestId);
  return {
    generateUploadUrl: async () => {
      return await performAsyncSyscall("storageGenerateUploadUrl", {
        requestId,
        version,
      });
    },
    delete: async (storageId: StorageId) => {
      await performAsyncSyscall("storageDelete", {
        requestId,
        version,
        storageId,
      });
    },
    getUrl: reader.getUrl,
    getMetadata: reader.getMetadata,
  };
}

export function setupStorageActionWriter(
  requestId: string
): StorageActionWriter {
  const writer = setupStorageWriter(requestId);
  return {
    ...writer,
    store: async (blob: Blob, options?: { sha256?: string }) => {
      return await performJsSyscall("storage/storeBlob", {
        requestId,
        version,
        blob,
        options,
      });
    },
    get: async (storageId: StorageId) => {
      return await performJsSyscall("storage/getBlob", {
        requestId,
        version,
        storageId,
      });
    },
  };
}
