import { spawn } from 'node:child_process';

export async function openUrl(url: string): Promise<void> {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true });
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true });
    return;
  }

  spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
}
