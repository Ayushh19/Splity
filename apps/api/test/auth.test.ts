import type { Profile } from '@splity/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_URL, testApp } from './helpers';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.close());

const json = { 'Content-Type': 'application/json' };

describe('health', () => {
  it('responds ok without auth', async () => {
    const res = await t.request('/api/health');
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('magic link sign-in', () => {
  it('rejects /me without a session', async () => {
    expect((await t.request('/api/me')).status).toBe(401);
  });

  it('emails a link on the public origin and signs a new user in', async () => {
    const cookie = await t.signIn('priya@example.com');
    const link = new URL(t.outbox.at(-1)!.url);
    expect(link.origin).toBe(BASE_URL);
    expect(link.pathname).toBe('/api/auth/magic-link/verify');

    const res = await t.request('/api/me', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      email: 'priya@example.com',
      displayName: '',
      upiId: null,
      defaultCurrency: 'INR',
    });
  });

  it('signing in again with the same email reuses the account', async () => {
    const me = async () =>
      (await (await t.request('/api/me', { headers: { Cookie: await t.signIn('arjun@example.com') } })).json()) as Profile;
    const first = await me();
    const second = await me();
    expect(second.id).toBe(first.id);
  });

  it('a magic link works only once', async () => {
    await t.signIn('rahul@example.com');
    const link = new URL(t.outbox.at(-1)!.url);
    const reuse = await t.request(link.pathname + link.search);
    expect(reuse.headers.getSetCookie().some((c) => c.startsWith('splity.session_token=') && !c.includes('Max-Age=0'))).toBe(false);
  });

  it('rejects sign-in requests from another origin', async () => {
    const res = await t.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { ...json, Origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'victim@example.com', callbackURL: 'https://evil.example/' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('sign-in code', () => {
  /** Ask for a sign-in email and return the code it carried. */
  async function requestCode(email: string) {
    const res = await t.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email, callbackURL: '/' }),
    });
    expect(res.status).toBe(200);
    const sent = t.outbox.at(-1)!;
    expect(sent.to).toBe(email);
    return sent.code;
  }
  const enterCode = (email: string, otp: string) =>
    t.request('/api/auth/sign-in/email-otp', { method: 'POST', headers: json, body: JSON.stringify({ email, otp }) });
  const sessionCookie = (res: Response) =>
    res.headers
      .getSetCookie()
      .filter((c) => c.startsWith('splity.session_token=') && !c.includes('Max-Age=0'))
      .map((c) => c.split(';')[0])
      .join('; ');

  it('the email carries a 6-digit code that signs in like the link', async () => {
    const code = await requestCode('meera@example.com');
    expect(code).toMatch(/^\d{6}$/);
    const res = await enterCode('meera@example.com', code);
    expect(res.status).toBe(200);
    const me = await t.request('/api/me', { headers: { Cookie: sessionCookie(res) } });
    expect(await me.json()).toMatchObject({ email: 'meera@example.com', displayName: '' });
  });

  it('the code and the link reach the same account', async () => {
    const viaLink = (await (await t.request('/api/me', { headers: { Cookie: await t.signIn('kabir@example.com') } })).json()) as Profile;
    const res = await enterCode('kabir@example.com', await requestCode('kabir@example.com'));
    const viaCode = (await (await t.request('/api/me', { headers: { Cookie: sessionCookie(res) } })).json()) as Profile;
    expect(viaCode.id).toBe(viaLink.id);
  });

  it('a code works only once', async () => {
    const code = await requestCode('neha@example.com');
    expect((await enterCode('neha@example.com', code)).status).toBe(200);
    const again = await enterCode('neha@example.com', code);
    expect(again.status).toBe(400);
    expect(sessionCookie(again)).toBe('');
  });

  it('a wrong code fails without using up the right one', async () => {
    const code = await requestCode('dev@example.com');
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await enterCode('dev@example.com', wrong)).status).toBe(400);
    expect((await enterCode('dev@example.com', code)).status).toBe(200);
  });

  it('stops accepting guesses after 5 wrong codes', async () => {
    const code = await requestCode('ira@example.com');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await enterCode('ira@example.com', wrong)).status).toBe(400);
    expect((await enterCode('ira@example.com', code)).status).toBe(403);
  });

  it('a new email replaces the previous code', async () => {
    const first = await requestCode('sana@example.com');
    let second = await requestCode('sana@example.com');
    // Codes are random; in the rare case they collide, ask again.
    while (second === first) second = await requestCode('sana@example.com');
    expect((await enterCode('sana@example.com', first)).status).toBe(400);
  });

  it('a code for one email does not sign in another', async () => {
    const code = await requestCode('owner@example.com');
    expect((await enterCode('someone-else@example.com', code)).status).toBe(400);
  });

  it("the plugin's own email, verification and password routes are off", async () => {
    for (const path of ['/email-otp/send-verification-otp', '/email-otp/check-verification-otp', '/forget-password/email-otp']) {
      const res = await t.request(`/api/auth${path}`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email: 'meera@example.com', type: 'sign-in', otp: '123456' }),
      });
      expect(res.status, path).toBe(404);
    }
  });
});

describe('profile', () => {
  it('updates name, UPI ID and default currency', async () => {
    const cookie = await t.signIn('meera@example.com');
    const res = await t.request('/api/me', {
      method: 'PATCH',
      headers: { ...json, Cookie: cookie },
      body: JSON.stringify({ displayName: '  Meera ', upiId: 'meera@okaxis', defaultCurrency: 'THB' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ displayName: 'Meera', upiId: 'meera@okaxis', defaultCurrency: 'THB' });

    const cleared = await t.request('/api/me', {
      method: 'PATCH',
      headers: { ...json, Cookie: cookie },
      body: JSON.stringify({ upiId: null }),
    });
    expect(await cleared.json()).toMatchObject({ upiId: null, displayName: 'Meera' });
  });

  it('rejects invalid values and unknown fields', async () => {
    const cookie = await t.signIn('kabir@example.com');
    for (const body of [{ upiId: 'not a upi' }, { defaultCurrency: 'XYZ' }, { displayName: '   ' }, { email: 'x@y.z' }]) {
      const res = await t.request('/api/me', { method: 'PATCH', headers: { ...json, Cookie: cookie }, body: JSON.stringify(body) });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});
