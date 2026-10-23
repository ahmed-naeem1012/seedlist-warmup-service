/**
 * The note placed above the forwarded email. The forward keeps the original's subject
 * ("Fwd: …"), so only `body` is used.
 *
 * input: { companyName, senderDomain, spamSubject, recipientFirstName }
 */

const SUBJECT = 'Landing in Spam';

// Opens on the bare first name; "Hi there," when the lookup gave us no name, so the email
// never starts with a stray comma.
function greetingFor(input) {
  return input.recipientFirstName ? `${input.recipientFirstName},` : 'Hi there,';
}

/**
 * For companies whose email Gmail itself filtered into Spam — the screenshot shows where
 * Gmail actually put it.
 */
const defaultTemplate = (input) => ({
  subject: SUBJECT,
  body: `${greetingFor(input)}

${input.companyName}'s emails to your leads are ending up in spam (screenshot attached).

Worth sharing how you can get more of them back to the inbox, to stop the leak?

Best,
Mike @Maxify.co`,
});

/**
 * For companies whose email our own sweeper moved into Spam (SPAM_OUTREACH_INCLUDE_SWEPT).
 * Gmail delivered their mail to the inbox, so this note says plainly that the screenshot
 * was set up by us, and makes no claim that their mail is landing in spam. Keep that
 * disclosure if the wording changes.
 */
const sweptTemplate = (input) => ({
  subject: SUBJECT,
  body: `${greetingFor(input)}

To be upfront: the attached screenshot shows ${input.companyName}'s email in our spam folder, but we moved it there ourselves to make a point. It didn't land there on its own.

The point is that plenty of companies' emails do end up in their leads' spam without anyone noticing. Worth a quick check of how ${input.companyName}'s emails are landing?

Best,
Mike @Maxify.co`,
});

module.exports = { defaultTemplate, sweptTemplate };
