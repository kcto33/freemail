export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printLine(value: string): void {
  process.stdout.write(`${value}\n`);
}

export function printError(value: string): void {
  process.stderr.write(`${value}\n`);
}
