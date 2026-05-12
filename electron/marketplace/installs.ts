import fs from 'node:fs';
import path from 'node:path';
import type {
  InstalledPackage,
  InstalledPackagesFile,
} from '../../shared/marketplace';

export function installedFilePath(dataDir: string): string {
  return path.join(dataDir, 'packages.json');
}

export function installKey(repo: string, packageId: string): string {
  return `${repo}#${packageId}`;
}

export async function readInstalled(dataDir: string): Promise<InstalledPackage[]> {
  const file = installedFilePath(dataDir);
  try {
    const buf = await fs.promises.readFile(file, 'utf8');
    const parsed = JSON.parse(buf) as InstalledPackagesFile;
    if (parsed && Array.isArray(parsed.installed)) return parsed.installed;
    return [];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

export async function writeInstalled(
  dataDir: string,
  installed: InstalledPackage[],
): Promise<void> {
  const file = installedFilePath(dataDir);
  await fs.promises.mkdir(dataDir, { recursive: true });
  const tmp = `${file}.tmp`;
  const bak = `${file}.bak`;
  const data: InstalledPackagesFile = { schemaVersion: 1, installed };
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2));
  try {
    await fs.promises.copyFile(file, bak);
  } catch {
    // first write — nothing to back up
  }
  await fs.promises.rename(tmp, file);
}

export async function findInstalled(
  dataDir: string,
  repo: string,
  packageId: string,
): Promise<InstalledPackage | undefined> {
  const all = await readInstalled(dataDir);
  const key = installKey(repo, packageId);
  return all.find((p) => p.key === key);
}

export async function upsertInstalled(
  dataDir: string,
  record: InstalledPackage,
): Promise<void> {
  const all = await readInstalled(dataDir);
  const idx = all.findIndex((p) => p.key === record.key);
  if (idx >= 0) all[idx] = record;
  else all.push(record);
  await writeInstalled(dataDir, all);
}
