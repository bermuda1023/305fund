type SendEmailArgs = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  bcc?: string | string[];
};

function toHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
}

export async function sendTransactionalEmail(args: SendEmailArgs): Promise<boolean> {
  const from = process.env.FROM_EMAIL || 'fund@305opportunitiesfund.com';
  const { to, subject, text } = args;
  const html = args.html || toHtml(text);
  const bccList = Array.isArray(args.bcc)
    ? args.bcc.filter(Boolean)
    : args.bcc
      ? [args.bcc]
      : [];

  const sendGridApiKey = process.env.SENDGRID_API_KEY;
  if (sendGridApiKey) {
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
        }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
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
        }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  return false;
}
