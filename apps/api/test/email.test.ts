import { afterEach, describe, expect, it, vi } from 'vitest';
import { signInEmail, withDevFallback } from '../src/email';

const email = { to: 'priya@example.com', url: 'http://localhost:3000/api/auth/magic-link/verify?token=abc&callbackURL=%2F', code: '482913' };
const failing = async () => {
  throw new Error('Invalid login: 535-5.7.8 Username and Password not accepted');
};

afterEach(() => vi.restoreAllMocks());

describe('withDevFallback', () => {
  it('outside production, prints the link when sending fails and still reports the failure', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(withDevFallback(failing, false)(email)).rejects.toThrow(/535/);
    expect(log.mock.calls.flat().join('\n')).toContain(email.url);
  });

  it('in production, never prints sign-in links', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(withDevFallback(failing, true)(email)).rejects.toThrow(/535/);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('signInEmail', () => {
  it('leads with the code and links back to the app', () => {
    const { subject, text, html } = signInEmail(email);
    expect(subject).toBe('482 913 is your Splity sign-in code');
    expect(text).toContain('482 913');
    expect(text).toContain(email.url);
    expect(html).toContain('482 913');
    // The link's query string survives HTML escaping.
    expect(html).toContain('href="http://localhost:3000/api/auth/magic-link/verify?token=abc&amp;callbackURL=%2F"');
  });
});
