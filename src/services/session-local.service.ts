import fs from 'fs/promises';
import path from 'path';

export interface LocalSessionData {
  turnId: string;
  transcriptPath: string;
  transcriptOffset: number;
}

const SESSION_DIR = '.kody/sessions';

function sessionPath(repoRoot: string, sessionId: string): string {
  return path.join(repoRoot, SESSION_DIR, `${sessionId}.json`);
}

export async function saveLocal(repoRoot: string, sessionId: string, data: LocalSessionData): Promise<void> {
  const filePath = sessionPath(repoRoot, sessionId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data) + '\n', 'utf-8');
}

export async function loadLocal(repoRoot: string, sessionId: string): Promise<LocalSessionData | null> {
  try {
    const content = await fs.readFile(sessionPath(repoRoot, sessionId), 'utf-8');
    return JSON.parse(content) as LocalSessionData;
  } catch {
    return null;
  }
}

export async function removeLocal(repoRoot: string, sessionId: string): Promise<void> {
  try {
    await fs.unlink(sessionPath(repoRoot, sessionId));
  } catch {
    // Ignore if file doesn't exist
  }
}
