export interface MagicLinkEmail {
  to: string;
  url: string;
}

export type SendMagicLink = (email: MagicLinkEmail) => Promise<void>;

/** Local development: print the link instead of sending an email. */
export const logMagicLink: SendMagicLink = async ({ to, url }) => {
  console.log(`\n[magic link] ${to}\n  ${url}\n`);
};

/**
 * Outside production, if sending fails (unverified sender, test-mode recipient…), print the
 * link as well so local sign-in keeps working. The request still fails, so the problem shows.
 */
export function withDevFallback(send: SendMagicLink, isProduction: boolean): SendMagicLink {
  if (isProduction) return send;
  return async (email) => {
    try {
      await send(email);
    } catch (e) {
      console.error(`[magic link] sending failed: ${e instanceof Error ? e.message : String(e)}`);
      await logMagicLink(email);
      throw e;
    }
  };
}

/** Send through Resend's HTTP API (no SDK needed). */
export function resendMagicLink(apiKey: string, from: string): SendMagicLink {
  return async ({ to, url }) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject: 'Your Splity sign-in link',
        text: `Tap to sign in to Splity:\n\n${url}\n\nThe link works once and expires in 10 minutes. If you didn't ask for it, ignore this email.`,
      }),
    });
    if (!res.ok) throw new Error(`Resend failed (${res.status}): ${await res.text()}`);
  };
}
