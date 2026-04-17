import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface CliConfig {
  baseUrl: string;
  accessToken: string;
  username: string;
  role: string;
  expiresAt: string;
  mailboxAddress?: string | null;
}

function resolveConfigPath(configDir?: string) {
  const dir = configDir ?? path.join(os.homedir(), '.freemail');
  return { dir, file: path.join(dir, 'config.json') };
}

export async function loadConfig(options: { configDir?: string } = {}): Promise<CliConfig> {
  const { file } = resolveConfigPath(options.configDir);
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw) as CliConfig;
}

export async function saveConfig(config: CliConfig, options: { configDir?: string } = {}): Promise<void> {
  const { dir, file } = resolveConfigPath(options.configDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function clearConfig(options: { configDir?: string } = {}): Promise<void> {
  const { file } = resolveConfigPath(options.configDir);
  await fs.rm(file, { force: true });
}
