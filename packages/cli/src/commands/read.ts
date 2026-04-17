import { type FreemailClient } from '../api.js';
import { emailReadAction, readMessage } from './email.js';

export { readMessage };

export async function readAction(options: {
  id: number;
  client?: Pick<FreemailClient, 'getMessage'>;
  json?: boolean;
}): Promise<void> {
  await emailReadAction(options);
}
