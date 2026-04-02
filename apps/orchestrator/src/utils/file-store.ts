import fs from 'node:fs/promises';
import path from 'node:path';

export async function ensureDirectory(directoryPath: string): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true });
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeTextFile(filePath: string, value: string): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, value, 'utf8');
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    const castError = error as NodeJS.ErrnoException;
    if (castError.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function readJsonFilesInDirectory<T>(directoryPath: string): Promise<T[]> {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const values: T[] = [];
    const sortedEntries = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of sortedEntries) {
      const fullPath = path.join(directoryPath, entry.name);
      const value = await readJsonFile<T>(fullPath);
      if (value !== null) {
        values.push(value);
      }
    }

    return values;
  } catch (error) {
    const castError = error as NodeJS.ErrnoException;
    if (castError.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
