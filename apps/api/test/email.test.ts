import { afterEach, describe, expect, it, vi } from 'vitest';
import { withDevFallback } from '../src/email';

const email = { to: 'priya@example.com', url: 'http://localhost:3000/api/auth/magic-link/verify?token=abc' };
const failing = async () => {
  throw new Error('Resend failed (403): domain is not verified');
};

afterEach(() => vi.restoreAllMocks());

describe('withDevFallback', () => {
  it('outside production, prints the link when sending fails and still reports the failure', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(withDevFallback(failing, false)(email)).rejects.toThrow(/403/);
    expect(log.mock.calls.flat().join('\n')).toContain(email.url);
  });

  it('in production, never prints sign-in links', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(withDevFallback(failing, true)(email)).rejects.toThrow(/403/);
    expect(log).not.toHaveBeenCalled();
  });
});
