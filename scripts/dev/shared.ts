import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashSkillFiles, type SkillFile } from '@bursar/tooling';

/** Absolute path of the repository root. */
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Regular files under `directory`, skipping `.git` and `node_modules` like the skills installer. */
async function collectFiles(root: string, directory: string = root): Promise<SkillFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<SkillFile[]> => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === '.git' || entry.name === 'node_modules'
          ? []
          : collectFiles(root, path);
      }
      return entry.isFile()
        ? [
            {
              relativePath: relative(root, path).split(sep).join('/'),
              content: await readFile(path),
            },
          ]
        : [];
    }),
  );
  return nested.flat();
}

/** Skills under `.claude/skills` (folders that contain a `SKILL.md`), each with its content hash. */
export async function installedSkillHashes(root: string = repoRoot): Promise<Map<string, string>> {
  const directory = join(root, '.claude', 'skills');
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const hashed = await Promise.all(
    entries.map(async ({ name }) => {
      const folder = join(directory, name);
      return (await exists(join(folder, 'SKILL.md')))
        ? ([name, hashSkillFiles(await collectFiles(folder))] as const)
        : undefined;
    }),
  );
  return new Map(hashed.filter((entry): entry is readonly [string, string] => entry !== undefined));
}
