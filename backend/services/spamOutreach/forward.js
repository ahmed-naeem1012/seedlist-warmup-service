const path = require('path');
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const { simpleParser } = require('mailparser');
const { config } = require('./config');

/**
 * Outreach as a FORWARD of the company's own email, rather than a fresh message.
 *
 * The recipient gets the note and the screenshot on top, then their own team's original
 * email underneath in Gmail's "---------- Forwarded message ---------" format — so they
 * recognise it at once.
 *
 * Done over IMAP and SMTP with the mailbox's app password: the original is fetched
 * straight from the Spam folder, the forward is built here, and it is either appended to
 * Drafts (IMAP) or sent (SMTP). Fetching over IMAP never marks the original read or loads
 * its images, so the sender's tracking pixels don't fire.
 *
 * input: { threadId (hex), fromEmail, to, cc?: string[], note, attachmentPath?, companyName? }
 */

/** What the recipient sees the attachment called — files on disk are named by thread id. */
function attachmentName(attachmentPath, companyName) {
  const ext = path.extname(attachmentPath);
  const kind = ext.toLowerCase() === '.mp4' ? 'video' : 'screenshot';
  // Characters some mail clients and file systems reject in a filename.
  const company = (companyName || '').replace(/[\\/:*?"<>|]/g, '').trim();
  return company ? `${company} - ${kind}${ext}` : `${kind}${ext}`;
}

function openImap() {
  const client = new ImapFlow({
    host: config.imap.host,
    port: 993,
    secure: true,
    auth: { user: config.mailbox.email, pass: config.imap.appPassword },
    logger: false,
  });
  // A dropped socket is reported as an 'error' event; unhandled, it would kill the process.
  client.on('error', () => {});
  return client;
}

async function folderBySpecialUse(client, flag, fallback) {
  const folders = await client.list();
  const found = folders.find((f) => f.specialUse === flag);
  return found ? found.path : fallback;
}

/**
 * Finds the original message by Gmail thread id: Spam first, where it was captured; All
 * Mail second, in case it has since been moved — All Mail excludes Spam, so both are
 * searched.
 */
async function fetchOriginal(client, input) {
  const gmailThreadId = BigInt(`0x${input.threadId}`).toString();
  const folders = [
    await folderBySpecialUse(client, '\\Junk', '[Gmail]/Spam'),
    await folderBySpecialUse(client, '\\All', '[Gmail]/All Mail'),
  ];

  for (const folder of folders) {
    const lock = await client.getMailboxLock(folder);
    try {
      const uids = await client.search({ threadId: gmailThreadId }, { uid: true });
      if (!uids || uids.length === 0) continue;

      // A thread can hold several messages. Prefer the newest one from the spam sender —
      // that is the email the screenshot showed.
      let fromSender;
      let newest;
      for await (const msg of client.fetch(uids, { envelope: true, source: true }, { uid: true })) {
        if (!msg.source) continue;
        newest = msg.source;
        const from = msg.envelope && msg.envelope.from && msg.envelope.from[0] && msg.envelope.from[0].address;
        if (from && from.toLowerCase() === input.fromEmail.toLowerCase()) fromSender = msg.source;
      }
      const chosen = fromSender || newest;
      if (chosen) return chosen;
    } finally {
      lock.release();
    }
  }

  throw new Error(
    `Original message for thread ${input.threadId} (${input.fromEmail}) is no longer in Spam or All Mail — ` +
      'it may have been deleted, and Gmail empties Spam after 30 days.'
  );
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function addresses(field) {
  if (!field) return [];
  return (Array.isArray(field) ? field : [field])
    .flatMap((f) => f.value)
    .filter((a) => a.address)
    .map((a) => ({ name: a.name || '', address: a.address || '' }));
}

/** Plain-text header form, as Gmail writes it: "Care One <noreply@x>", or "<x>" with no name. */
function plainAddresses(field) {
  return addresses(field).map((a) => (a.name ? `${a.name} <${a.address}>` : `<${a.address}>`)).join(', ');
}

function mailto(address) {
  return `&lt;<a href="mailto:${escapeHtml(address)}">${escapeHtml(address)}</a>&gt;`;
}

/** Gmail's own forward header date style: "Wed, Oct 1, 2026 at 2:28 PM". */
function formatDate(date) {
  if (!date) return '';
  const day = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

/** The forwarded block's header lines in Gmail's own markup, sender name in bold. */
function gmailHeaderHtml(original, subject) {
  const from = addresses(original.from)[0];
  const list = (field) =>
    addresses(field).map((a) => (a.name ? `${escapeHtml(a.name)} ${mailto(a.address)}` : mailto(a.address))).join(', ');
  const lines = [
    '---------- Forwarded message ---------',
    from
      ? `From: <strong class="gmail_sendername" dir="auto">${escapeHtml(from.name || from.address)}</strong> <span dir="auto">${mailto(from.address)}</span>`
      : 'From: ',
    `Date: ${escapeHtml(formatDate(original.date))}`,
    `Subject: ${escapeHtml(subject)}`,
    `To: ${list(original.to)}`,
  ];
  if (original.cc) lines.push(`Cc: ${list(original.cc)}`);
  return lines.join('<br>');
}

function referencesOf(original) {
  const refs = original.references;
  return Array.isArray(refs) ? refs : refs ? [refs] : [];
}

/** The inner <body> of an HTML email, so it can sit inside the forward's own markup. */
function htmlBody(html) {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return match ? match[1] : html;
}

function buildForward(original, input) {
  const subject = original.subject || '';
  const headerLines = [
    '---------- Forwarded message ---------',
    `From: ${plainAddresses(original.from)}`,
    `Date: ${formatDate(original.date)}`,
    `Subject: ${subject}`,
    `To: ${plainAddresses(original.to)}`,
  ];
  if (original.cc) headerLines.push(`Cc: ${plainAddresses(original.cc)}`);

  const text = `${input.note}\n\n${headerLines.join('\n')}\n\n${original.text || ''}`;

  const noteHtml = escapeHtml(input.note).replace(/\n/g, '<br>');
  const quotedHtml = original.html ? htmlBody(original.html) : escapeHtml(original.text || '').replace(/\n/g, '<br>');
  const html =
    `<div dir="ltr">${noteHtml}</div><br>` +
    `<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">${gmailHeaderHtml(original, subject)}<br></div><br><br>` +
    `${quotedHtml}</div>`;

  // The original's own attachments travel with it, as in Gmail. Inline images keep their
  // content ids so the quoted HTML still renders them.
  const carried = original.attachments.map((a) => ({
    filename: a.filename,
    content: a.content,
    contentType: a.contentType,
    cid: a.contentId ? a.contentId.replace(/^<|>$/g, '') : undefined,
    contentDisposition: a.contentDisposition === 'inline' ? 'inline' : 'attachment',
  }));

  return {
    from: config.senderName ? { name: config.senderName, address: config.mailbox.email } : config.mailbox.email,
    to: input.to,
    cc: input.cc,
    subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`,
    // What makes it a real forward rather than a new email titled "Fwd:": Gmail's own
    // Forward points these at the original, so mail clients file the forward in the same
    // conversation as the original wherever both are present.
    inReplyTo: original.messageId,
    references: [...referencesOf(original), ...(original.messageId ? [original.messageId] : [])],
    text,
    html,
    attachments: [
      ...(input.attachmentPath ? [{ filename: attachmentName(input.attachmentPath, input.companyName), path: input.attachmentPath }] : []),
      ...carried,
    ],
  };
}

/**
 * Forwards the original spam message, either into Drafts or straight out. Sending happens
 * ONLY when `options.send` is true (SPAM_OUTREACH_SEND_ENABLED); otherwise the forward is
 * saved to Drafts for a human to review.
 */
async function forwardMessage(input, options = {}) {
  const client = openImap();
  await client.connect();
  try {
    const original = await simpleParser(await fetchOriginal(client, input));
    const mail = buildForward(original, input);

    if (options.send) {
      const transport = nodemailer.createTransport({
        host: config.smtp.host,
        port: 465,
        secure: true,
        auth: { user: config.mailbox.email, pass: config.imap.appPassword },
      });
      const info = await transport.sendMail(mail);
      // Confirm the server took every recipient rather than assuming it did — a message
      // recorded as sent when it was not would otherwise be retried at the same person.
      const rejected = (info.rejected || []).map(String);
      if (rejected.length > 0 || (info.accepted || []).length === 0) {
        throw new Error(`SMTP did not accept the forward (rejected: ${rejected.join(', ') || 'all'}). Check Sent before retrying.`);
      }
      // Gmail's SMTP files a copy in Sent by itself.
      return { sent: true };
    }

    const raw = await new MailComposer(mail).compile().build();
    const drafts = await folderBySpecialUse(client, '\\Drafts', '[Gmail]/Drafts');
    await client.append(drafts, raw, ['\\Draft', '\\Seen']);
    return { sent: false };
  } finally {
    await client.logout().catch(() => {});
  }
}

module.exports = { forwardMessage, buildForward, attachmentName };
