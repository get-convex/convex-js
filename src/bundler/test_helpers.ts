// this is just a tst helper, we can ignore
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-restricted-imports */

import { Dirent, Stats, ReadStream, Mode } from "fs";
import { Filesystem, TempPath } from "./fs.js";
import path from "path";

interface TestFile {
  content: string;
  stats?: Partial<Stats>;
}

interface TestDirectory {
  files: TestFileStructure;
  stats?: Partial<Stats>;
}

export interface TestFileStructure {
  [key: string]: TestFile | TestDirectory | TestFileStructure | string;
}

function isTestDirectory(value: any): value is TestDirectory {
  return value && typeof value === "object" && "files" in value;
}

function isTestFile(value: any): value is TestFile {
  return value && typeof value === "object" && "content" in value;
}

export class TestFilesystem implements Filesystem {
  private fileSystem: Map<string, TestFile | TestDirectory> = new Map();
  private defaultStats: Stats;

  constructor(structure: TestFileStructure = {}) {
    const now = new Date();
    this.defaultStats = {
      dev: 1,
      ino: 1,
      mode: 33188,
      nlink: 1,
      uid: 1000,
      gid: 1000,
      rdev: 0,
      size: 100,
      blksize: 4096,
      blocks: 8,
      atimeMs: now.getTime(),
      mtimeMs: now.getTime(),
      ctimeMs: now.getTime(),
      birthtimeMs: now.getTime(),
      atime: now,
      mtime: now,
      ctime: now,
      birthtime: now,
      isFile: () => true,
      isDirectory: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    };

    this.loadStructure("/", structure);
  }

  private loadStructure(basePath: string, structure: TestFileStructure) {
    for (const [name, value] of Object.entries(structure)) {
      const fullPath = path.join(basePath, name);

      if (typeof value === "string") {
        // Simple string content
        this.fileSystem.set(fullPath, { content: value });
      } else if (isTestFile(value)) {
        // TestFile object
        this.fileSystem.set(fullPath, value);
      } else if (isTestDirectory(value)) {
        // TestDirectory object
        this.fileSystem.set(fullPath, value);
        this.loadStructure(fullPath, value.files);
      } else if (typeof value === "object") {
        // Plain object treated as directory
        const dir: TestDirectory = { files: value as any };
        this.fileSystem.set(fullPath, dir);
        this.loadStructure(fullPath, value as TestFileStructure);
      }
    }
  }

  listDir(dirPath: string): Dirent[] {
    const entries: Dirent[] = [];
    const normalizedPath = path.normalize(dirPath);

    // Find all entries that are direct children of this directory
    for (const [filePath, entry] of this.fileSystem.entries()) {
      const dir = path.dirname(filePath);
      if (dir === normalizedPath) {
        const name = path.basename(filePath);
        const dirent = Object.assign(Object.create(null), {
          name,
          path: dirPath,
          parentPath: path.dirname(dirPath),
          isFile: () => !isTestDirectory(entry),
          isDirectory: () => isTestDirectory(entry),
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        }) as Dirent;
        entries.push(dirent);
      }
    }

    return entries;
  }

  exists(filePath: string): boolean {
    return this.fileSystem.has(path.normalize(filePath));
  }

  stat(filePath: string): Stats {
    const entry = this.fileSystem.get(path.normalize(filePath));
    if (!entry) {
      throw new Error(`ENOENT: no such file or directory, stat '${filePath}'`);
    }

    const customStats = (isTestFile(entry) ? entry.stats : isTestDirectory(entry) ? entry.stats : {}) || {};
    const isDir = isTestDirectory(entry);

    return {
      ...this.defaultStats,
      ...customStats,
      isFile: () => !isDir,
      isDirectory: () => isDir,
      size: isTestFile(entry) ? entry.content.length : 0,
    };
  }

  readUtf8File(filePath: string): string {
    const entry = this.fileSystem.get(path.normalize(filePath));
    if (!entry) {
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    }
    if (isTestDirectory(entry)) {
      throw new Error(`EISDIR: illegal operation on a directory, read '${filePath}'`);
    }
    return isTestFile(entry) ? entry.content : (entry as any);
  }

  createReadStream(_filePath: string, _options: { highWaterMark?: number }): ReadStream {
    // For test purposes, we don't need a real stream
    throw new Error("createReadStream not implemented in TestFilesystem");
  }

  access(filePath: string): void {
    if (!this.exists(filePath)) {
      throw new Error(`ENOENT: no such file or directory, access '${filePath}'`);
    }
  }

  writeUtf8File(filePath: string, contents: string, _mode?: Mode): void {
    this.fileSystem.set(path.normalize(filePath), { content: contents });
  }

  mkdir(dirPath: string, options?: { allowExisting?: boolean; recursive?: boolean }): void {
    const normalizedPath = path.normalize(dirPath);
    if (this.exists(normalizedPath) && !options?.allowExisting) {
      throw new Error(`EEXIST: file already exists, mkdir '${dirPath}'`);
    }
    this.fileSystem.set(normalizedPath, { files: {} });
  }

  rmdir(dirPath: string): void {
    this.fileSystem.delete(path.normalize(dirPath));
  }

  unlink(filePath: string): void {
    this.fileSystem.delete(path.normalize(filePath));
  }

  swapTmpFile(fromPath: TempPath, toPath: string): void {
    const content = this.fileSystem.get(fromPath);
    if (content) {
      this.fileSystem.set(path.normalize(toPath), content);
      this.fileSystem.delete(fromPath);
    }
  }

  registerPath(_filePath: string, _st: Stats | null): void {
    // No-op for test filesystem
  }

  invalidate(): void {
    // No-op for test filesystem
  }
}