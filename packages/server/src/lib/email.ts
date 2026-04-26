type EmailAttachment = {
  filename: string;
  contentType: string;
  contentBase64: string;
};

type SendEmailArgs = {
  to: string;
  from?: string;
  subject: string;
  text: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: EmailAttachment[];
};

export type SendEmailResult = {
  ok: boolean;
  provider?: 'sendgrid' | 'resend';
  statusCode?: number;
  error?: string;
};

function toHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
}

function truncate(s: string, max = 500): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export async function sendTransactionalEmailDetailed(args: SendEmailArgs): Promise<SendEmailResult> {
  const from = String(args.from || process.env.FROM_EMAIL || 'info@305opportunityfund.com').trim()
    || 'info@305opportunityfund.com';
  const { to, subject, text } = args;
  const html = args.html || toHtml(text);
  const ccList = Array.isArray(args.cc)
    ? args.cc.filter(Boolean)
    : args.cc
      ? [args.cc]
      : [];
  const bccList = Array.isArray(args.bcc)
    ? args.bcc.filter(Boolean)
    : args.bcc
      ? [args.bcc]
      : [];
  const attachments = (args.attachments || []).filter(
    (a) => a && a.filename && a.contentType && a.contentBase64
  );

  const sendGridApiKey = process.env.SENDGRID_API_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  let attempted = false;
  let lastError: SendEmailResult | null = null;

  if (sendGridApiKey) {
    attempted = true;
    try {
      const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sendGridApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{
            to: [{ email: to }],
            ...(ccList.length > 0 ? { cc: ccList.map((email) => ({ email })) } : {}),
            ...(bccList.length > 0 ? { bcc: bccList.map((email) => ({ email })) } : {}),
          }],
          from: { email: from },
          subject,
          content: [
            { type: 'text/plain', value: text },
            { type: 'text/html', value: html },
          ],
          ...(attachments.length > 0
            ? {
                attachments: attachments.map((a) => ({
                  content: a.contentBase64,
                  filename: a.filename,
                  type: a.contentType,
                  disposition: 'attachment',
                })),
              }
            : {}),
        }),
      });
      if (resp.ok) {
        return { ok: true, provider: 'sendgrid', statusCode: resp.status };
      }
      let body = '';
      try { body = await resp.text(); } catch {}
      const errText = `SendGrid ${resp.status}: ${truncate(body)}`;
      console.error(`SendGrid email failed (${resp.status}): ${truncate(body)}`);
      lastError = { ok: false, provider: 'sendgrid', statusCode: resp.status, error: errText };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error(`SendGrid email exception: ${msg}`);
      lastError = { ok: false, provider: 'sendgrid', error: `SendGrid exception: ${truncate(msg)}` };
    }
  }

  if (resendApiKey) {
    attempted = true;
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          ...(ccList.length > 0 ? { cc: ccList } : {}),
          ...(bccList.length > 0 ? { bcc: bccList } : {}),
          subject,
          text,
          html,
          ...(attachments.length > 0
            ? {
                attachments: attachments.map((a) => ({
                  filename: a.filename,
                  content: a.contentBase64,
                  content_type: a.contentType,
                })),
              }
            : {}),
        }),
      });
      if (resp.ok) {
        return { ok: true, provider: 'resend', statusCode: resp.status };
      }
      let body = '';
      try { body = await resp.text(); } catch {}
      const errText = `Resend ${resp.status}: ${truncate(body)}`;
      console.error(`Resend email failed (${resp.status}): ${truncate(body)}`);
      lastError = { ok: false, provider: 'resend', statusCode: resp.status, error: errText };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error(`Resend email exception: ${msg}`);
      lastError = { ok: false, provider: 'resend', error: `Resend exception: ${truncate(msg)}` };
    }
  }

  if (!attempted) {
    const msg = 'No email provider configured: set SENDGRID_API_KEY or RESEND_API_KEY';
    console.error(msg);
    return { ok: false, error: msg };
  }
  console.error('All configured email providers failed to send this message.');
  return lastError || { ok: false, error: 'Unknown email provider failure' };
}

export async function sendTransactionalEmail(args: SendEmailArgs): Promise<boolean> {
  const result = await sendTransactionalEmailDetailed(args);
  return result.ok;
}
