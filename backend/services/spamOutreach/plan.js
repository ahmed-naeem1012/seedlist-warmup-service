const { defaultTemplate, sweptTemplate } = require('./template');

/**
 * Whether our sweeper put this company's mail in Spam — the thread itself, or any mail
 * from the same domain (moving mail reports the sender, so Gmail's later filtering of
 * them is partly our doing). Anything recorded on the entry counts too.
 *
 * record: { forcedThreads: Set<threadId>, forcedDomains: Set<domain> }
 */
function isSwept(threadId, fromDomain, record, entry) {
  return Boolean(
    (entry && (entry.spamSource === 'forced_by_us' || entry.spamEvidence === false || entry.swept === true)) ||
      record.forcedThreads.has(threadId) ||
      record.forcedDomains.has((fromDomain || '').toLowerCase())
  );
}

/**
 * Which note and attachment a company gets.
 *
 *   Gmail filtered it  → defaultTemplate + the spam-folder screenshot (or video).
 *   Our sweeper did    → sweptTemplate + the screenshot.
 *
 * A swept company can never fall through to defaultTemplate: with no sweptTemplate it is
 * held instead. Returns one of:
 *   { kind: 'skip_swept' }                  swept, INCLUDE_SWEPT off: never contacted
 *   { kind: 'hold', reason }                swept, no swept note written: stays queued
 *   { kind: 'missing_attachment' }          nothing to attach: stays queued
 *   { kind: 'go', swept, template, attachmentPath }
 */
function planOutreach(entry, swept, includeSwept, sweptNote = sweptTemplate || null) {
  if (swept) {
    if (!includeSwept) return { kind: 'skip_swept' };
    if (!sweptNote) return { kind: 'hold', reason: 'sweptTemplate is not written yet' };
    // The plain screenshot only, never the video.
    if (!entry.screenshotPath) return { kind: 'missing_attachment' };
    return { kind: 'go', swept: true, template: sweptNote, attachmentPath: entry.screenshotPath };
  }
  // Prefer the composite video; fall back to the plain screenshot if rendering failed.
  const attachmentPath = entry.videoPath || entry.screenshotPath;
  if (!attachmentPath) return { kind: 'missing_attachment' };
  return { kind: 'go', swept: false, template: defaultTemplate, attachmentPath };
}

module.exports = { isSwept, planOutreach };
