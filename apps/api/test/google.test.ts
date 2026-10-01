import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_URL, testApp } from './helpers';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp({ google: { clientId: 'test-client', clientSecret: 'test-secret', redirectUri: BASE_URL } });
});
afterAll(() => t.close());

describe('Google sign-in', () => {
  it('is advertised to the sign-in screen', async () => {
    expect(await (await t.request('/api/config')).json()).toMatchObject({ google: true });
  });

  it('sends Google the configured redirect URI exactly', async () => {
    const res = await t.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
    });
    expect(res.status).toBe(200);
    const url = new URL(((await res.json()) as { url: string }).url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000');
    expect(url.searchParams.get('client_id')).toBe('test-client');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('sends a failed Google return to the sign-in screen, not the built-in error page', async () => {
    const res = await t.request('/api/auth/callback/google?state=bogus&error=access_denied');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(`${BASE_URL}/sign-in`);
    expect(location.searchParams.get('error')).toBeTruthy();
  });
});
