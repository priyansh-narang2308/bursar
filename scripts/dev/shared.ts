import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Names of the skills under `.claude/skills`: directories that contain a `SKILL.md`. */
export async function installedSkillNames(root: string = repoRoot): Promise<Set<string>> {
  const directory = join(root, '.claude', 'skills');
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const names = await Promise.all(
    entries.map(async ({ name }) =>
      (await exists(join(directory, name, 'SKILL.md'))) ? name : undefined,
    ),
  );
  return new Set(names.filter((name): name is string => name !== undefined));
}
