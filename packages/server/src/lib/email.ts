type EmailAttachment = {
  filename: string;
  contentType: string;
  contentBase64: string;
};

type SendEmailArgs = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  bcc?: string | string[];
  attachments?: EmailAttachment[];
};

function toHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
}

export async function sendTransactionalEmail(args: SendEmailArgs): Promise<boolean> {
  const from = 'info@305opportunityfund.com';
  const { to, subject, text } = args;
  const html = args.html || toHtml(text);
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
      if (!resp.ok) {
        let body = '';
        try { body = await resp.text(); } catch {}
        console.error(`SendGrid email failed (${resp.status}): ${body.slice(0, 500)}`);
      } else {
        return true;
      }
    } catch (err: any) {
      console.error(`SendGrid email exception: ${err?.message || err}`);
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
      if (!resp.ok) {
        let body = '';
        try { body = await resp.text(); } catch {}
        console.error(`Resend email failed (${resp.status}): ${body.slice(0, 500)}`);
      } else {
        return true;
      }
    } catch (err: any) {
      console.error(`Resend email exception: ${err?.message || err}`);
    }
  }

  if (!attempted) {
    console.error('No email provider configured: set SENDGRID_API_KEY or RESEND_API_KEY');
  } else {
    console.error('All configured email providers failed to send this message.');
  }
  return false;
}
