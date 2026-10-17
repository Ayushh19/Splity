import nodemailer from 'nodemailer';

export interface MagicLinkEmail {
  to: string;
  url: string;
  /** 6-digit code that signs in like the link (for when the link opens in the wrong browser). */
  code: string;
}

export type SendMagicLink = (email: MagicLinkEmail) => Promise<void>;

/** Local development: print the link instead of sending an email. */
export const logMagicLink: SendMagicLink = async ({ to, url, code }) => {
  console.log(`\n[magic link] ${to}\n  code ${code}\n  ${url}\n`);
};

/** The sign-in email: the code first (works in any browser or the installed app), then the link. */
export function signInEmail({ url, code }: MagicLinkEmail) {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const subject = `${spaced} is your Splity sign-in code`;
  const text = [
    `Your Splity sign-in code is ${spaced}`,
    '',
    'Type it into Splity, or tap this link to sign in on this device:',
    url,
    '',
    "The code and link work once and expire in 10 minutes. If you didn't ask for them, ignore this email.",
  ].join('\n');
  const href = url.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px 16px;background:#1A1A1A;color:#E8E0D0;font-family:ui-monospace,Menlo,Consolas,monospace">
  <div style="max-width:420px;margin:0 auto">
    <p style="margin:0 0 4px;color:#D2B48C;font-size:13px;letter-spacing:0.06em">SPLITY // SIGN-IN CODE</p>
    <p style="margin:0 0 20px;padding:16px;border:2px solid #333333;border-radius:4px;background:#242424;color:#33FF00;font-size:36px;font-weight:600;letter-spacing:0.2em;text-align:center">${spaced}</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Type this code into Splity. Or sign in on this device with the button:</p>
    <p style="margin:0 0 24px"><a href="${href}" style="display:inline-block;padding:14px 20px;border-radius:8px;background:#33FF00;color:#1A1A1A;font-weight:600;text-decoration:none">Sign in to Splity</a></p>
    <p style="margin:0;color:#A6A6A6;font-size:13px;line-height:1.5">The code and link work once and expire in 10 minutes. If you didn't ask for them, ignore this email.</p>
  </div>
</body></html>`;
  return { subject, text, html };
}

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

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

/**
 * Send over SMTP from your own mail account (e.g. Gmail with an app password). No domain or
 * mail provider needed; the message goes out as that account.
 */
export function smtpMagicLink(smtp: SmtpConfig, from: string): SendMagicLink {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465, // 465 is TLS from the start; 587 upgrades with STARTTLS
    auth: { user: smtp.user, pass: smtp.pass },
  });
  return async (email) => {
    await transport.sendMail({ from, to: email.to, ...signInEmail(email) });
  };
}
