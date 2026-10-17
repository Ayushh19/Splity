import nodemailer from 'nodemailer';

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
  return async ({ to, url }) => {
    await transport.sendMail({
      from,
      to,
      subject: 'Your Splity sign-in link',
      text: `Tap to sign in to Splity:\n\n${url}\n\nThe link works once and expires in 10 minutes. If you didn't ask for it, ignore this email.`,
    });
  };
}
