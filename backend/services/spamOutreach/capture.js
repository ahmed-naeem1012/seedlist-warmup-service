const path = require('path');
const fs = require('fs/promises');
const { ROW_SELECTOR, waitInPage, sleep } = require('./gmailBrowser');

/**
 * Screenshots the whole Spam folder with the pointer resting on one specific message and a
 * red ring around it. The message is never opened — only its row is hovered — so it stays
 * unread and the sender's tracking pixels never fire.
 */

const CURSOR_ELEMENT_ID = '__spam_outreach_cursor__';
const SPACER_ELEMENT_ID = '__spam_outreach_spacer__';
const HIGHLIGHT_ELEMENT_ID = '__spam_outreach_highlight__';

// A pointer arrow drawn into the page itself. Chromium screenshots never contain the real
// mouse cursor — the OS draws it, not the page — so the hover is real (that is what makes
// Gmail light the row up and show its action buttons) and only the arrow is drawn, at
// exactly where the real pointer rests.
const CURSOR_PATH = 'M3 2 L3 20.5 L7.7 15.8 L11 23.5 L14.2 22.1 L11 14.6 L17.5 14.6 Z';

/**
 * Marks the target row in the page with a data attribute, so every later step addresses
 * exactly that element. Found by thread id rather than position, because new spam arriving
 * between listing and capture re-renders the list and shifts every row — the pointer must
 * always be on the message the screenshot claims to show. A visible match is preferred,
 * since Gmail keeps hidden copies of rows from pages it has shown before.
 *
 * (A shared finder function can't be passed into the page as a string: Gmail's Trusted
 * Types policy blocks evaluating strings as code.)
 */
const TARGET_ATTR = 'data-spam-outreach-target';
const TARGET_SELECTOR = `[${TARGET_ATTR}]`;

async function markTargetRow(page, message) {
  return page.evaluate(
    (rowSelector, id, rowIndex, attr) => {
      document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
      const rows = Array.from(document.querySelectorAll(rowSelector));
      const matches = rows.filter((r) => r.querySelector(`span[data-legacy-thread-id="${id}"]`));
      const row = matches.find((r) => r.offsetParent) || matches[0] || rows[rowIndex] || null;
      if (!row) return false;
      row.setAttribute(attr, '');
      return true;
    },
    ROW_SELECTOR,
    message.id,
    message.rowIndex,
    TARGET_ATTR
  );
}

async function rowBox(page) {
  return page.evaluate((selector) => {
    const row = document.querySelector(selector);
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, TARGET_SELECTOR);
}

/**
 * Makes sure "Spam" is visible in the left sidebar — Gmail tucks it under the collapsed
 * "More" section, which would leave the word Spam nowhere on the screenshot. Gmail
 * remembers the expanded state, so after the first time this is a no-op.
 */
async function ensureSpamInSidebar(page) {
  const visible = () => {
    const link = Array.from(document.querySelectorAll('a[href$="#spam"]')).find((a) => a.offsetParent);
    return Boolean(link);
  };
  if (await page.evaluate(visible)) return;

  // Gmail renders two copies of the toggle (one hidden); the visible one is the target.
  await page.evaluate(() => {
    const toggle = Array.from(document.querySelectorAll('span[role="button"]')).find(
      (b) => b.offsetParent && Array.from(b.children).some((c) => c.tagName === 'SPAN' && c.textContent.trim() === 'More')
    );
    if (toggle) toggle.click();
  });
  await waitInPage(page, visible, null, 3000, 300);
}

async function showCursorAt(page, x, y) {
  await page.evaluate(
    ({ x, y, id, d }) => {
      const old = document.getElementById(id);
      if (old) old.remove();
      // Built with DOM calls rather than innerHTML: Gmail enforces Trusted Types, which
      // rejects assigning an HTML string outright.
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '20');
      svg.setAttribute('height', '28');
      svg.setAttribute('viewBox', '0 0 20 28');
      const shape = document.createElementNS(NS, 'path');
      shape.setAttribute('d', d);
      shape.setAttribute('fill', '#ffffff');
      shape.setAttribute('stroke', '#000000');
      shape.setAttribute('stroke-width', '1.3');
      shape.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(shape);
      const el = document.createElement('div');
      el.id = id;
      el.appendChild(svg);
      el.style.cssText = [
        'position:fixed',
        `left:${x}px`,
        `top:${y}px`,
        'width:20px',
        'height:28px',
        'z-index:2147483647',
        'pointer-events:none',
        'filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))',
      ].join(';');
      document.body.appendChild(el);
    },
    { x, y, id: CURSOR_ELEMENT_ID, d: CURSOR_PATH }
  );
}

/** A red, pill-shaped ring slightly larger than the row, so it circles it without hiding text. */
async function showHighlightAround(page, box) {
  await page.evaluate(
    ({ box, id }) => {
      const old = document.getElementById(id);
      if (old) old.remove();
      const pad = 6;
      const el = document.createElement('div');
      el.id = id;
      el.style.cssText = [
        'position:fixed',
        `left:${box.x - pad}px`,
        `top:${box.y - pad}px`,
        `width:${box.width + pad * 2}px`,
        `height:${box.height + pad * 2}px`,
        'box-sizing:border-box',
        'border:3px solid #e53935',
        'border-radius:999px',
        // Just under the drawn cursor, so the pointer sits on top of the ring.
        'z-index:2147483646',
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(el);
    },
    { box, id: HIGHLIGHT_ELEMENT_ID }
  );
}

async function removeOverlays(page) {
  await page
    .evaluate((ids) => ids.forEach((id) => document.getElementById(id) && document.getElementById(id).remove()), [
      CURSOR_ELEMENT_ID,
      HIGHLIGHT_ELEMENT_ID,
      SPACER_ELEMENT_ID,
    ])
    .catch(() => {});
}

/**
 * Captures one message. Returns { screenshotPath, rowCentreFraction } — how far down the
 * frame the row ended up (0 = top, 1 = bottom).
 */
async function captureSpamMessage(page, message, screenshotsDir) {
  // First of all: expanding the sidebar makes Gmail redraw the page, which would
  // invalidate any row already measured.
  await ensureSpamInSidebar(page);

  // Centre the target row in the viewport. scrollIntoView({block:"center"}) centres it
  // within Gmail's scrolling list, which starts below the toolbar, so a second pass nudges
  // the list until the row's midpoint matches the window's. Rows at the end of the list
  // have nothing below them to scroll into view, so a temporary spacer is added under the
  // list to make room — removed straight after the screenshot.
  if (!(await markTargetRow(page, message))) {
    throw new Error(`Spam row for thread ${message.id} is not in the page; cannot capture.`);
  }

  const found = await page.evaluate(
    (selector, spacerId) => {
      const el = document.querySelector(selector);
      if (!el) return false;

      let scroller = null;
      for (let node = el.parentElement; node; node = node.parentElement) {
        const overflowY = getComputedStyle(node).overflowY;
        if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) {
          scroller = node;
          break;
        }
      }
      // A spacer element, not padding: Chrome ignores a scroll container's bottom padding
      // when working out how far it can scroll.
      if (scroller) {
        const old = document.getElementById(spacerId);
        if (old) old.remove();
        const spacer = document.createElement('div');
        spacer.id = spacerId;
        spacer.style.cssText = `height:${window.innerHeight}px;width:1px;flex:none;pointer-events:none`;
        scroller.appendChild(spacer);
      }

      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = el.getBoundingClientRect();
      const delta = rect.top + rect.height / 2 - window.innerHeight / 2;
      if (Math.abs(delta) >= 4) {
        if (scroller) scroller.scrollTop += delta;
        else window.scrollBy(0, delta);
      }
      return true;
    },
    TARGET_SELECTOR,
    SPACER_ELEMENT_ID
  );
  if (!found) {
    throw new Error(`Spam row for thread ${message.id} is not in the page; cannot capture.`);
  }

  // Let Gmail settle after the scroll before measuring anything.
  await sleep(400);

  // Real hover — a plain mouse move to the row's centre, which triggers Gmail's row
  // highlight and action icons.
  const hoverBox = await rowBox(page);
  if (!hoverBox || hoverBox.width === 0) {
    throw new Error(`Spam row ${message.rowIndex} (${message.id}) is not on screen; cannot hover it.`);
  }
  await page.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2);
  await sleep(300);

  // Belt and braces: confirm the row about to be shot really is this message.
  const hoveredId = await page.evaluate((selector) => {
    const row = document.querySelector(selector);
    const span = row && row.querySelector('span[data-legacy-thread-id]');
    return span ? span.getAttribute('data-legacy-thread-id') : null;
  }, TARGET_SELECTOR);
  if (hoveredId && hoveredId !== message.id) {
    throw new Error(
      `Refusing to capture: expected thread ${message.id} but the hovered row is ${hoveredId}. ` +
        'The spam list shifted underneath us; this message will be retried next cycle.'
    );
  }

  const box = await rowBox(page);
  if (!box) {
    throw new Error(`Spam row ${message.rowIndex} (${message.id}) is not visible; cannot capture.`);
  }
  const viewport = page.viewport();
  const rowCentreFraction = viewport ? (box.y + box.height / 2) / viewport.height : 0.5;

  // Rest the pointer partway across the row, over the subject text rather than the
  // checkbox or the hover action buttons at either end.
  let x = box.x + Math.min(box.width * 0.4, 420);
  let y = box.y + box.height / 2;
  if (viewport) {
    x = Math.max(0, Math.min(x, viewport.width - 20));
    y = Math.max(0, Math.min(y, viewport.height - 28));
  }
  // Keep the real pointer where the drawn arrow will be, so the hover stays on this row.
  await page.mouse.move(x, y);

  const mailboxDir = path.join(screenshotsDir, message.mailboxId);
  await fs.mkdir(mailboxDir, { recursive: true });
  const screenshotPath = path.join(mailboxDir, `${message.id}.png`);

  await showHighlightAround(page, box);
  await showCursorAt(page, x, y);
  try {
    await page.screenshot({ path: screenshotPath });
  } finally {
    // Always clear these, or the arrow, ring, spacer and marker accumulate across messages.
    await removeOverlays(page);
    await page
      .evaluate((attr) => document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr)), TARGET_ATTR)
      .catch(() => {});
  }

  return { screenshotPath, rowCentreFraction };
}

module.exports = { captureSpamMessage };
