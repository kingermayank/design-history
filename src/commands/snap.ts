import { runCapture } from './capture.js';

export async function runSnap(label?: string): Promise<void> {
  await runCapture({
    source: 'snap',
    label,
    skipExisting: false,
  });
}
