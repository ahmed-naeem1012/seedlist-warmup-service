// Port of maxify-proj/dashboard/lib/templateRenderer.ts — kept behavior-identical
// (same block types, same markup/styles) so a template renders the same way
// here as it does in the dashboard's own preview. TS types stripped only.

// Only these three resolve to real data — they're filled in per-recipient at
// send time from the recipient's own email address (see
// utils/personalization.js). Any other {{word}} is a stray/unsupported
// variable and is dropped entirely rather than left as literal "{{foo}}"
// text in the sent email. When a whitelisted var isn't in `data` yet (block
// rendering happens before the recipient is known), it's left untouched so
// the per-recipient pass at send time can still resolve it.
const RECIPIENT_VARIABLES = new Set(['first_name', 'last_name', 'email']);

const renderHandlebars = (template, data) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    if (!RECIPIENT_VARIABLES.has(key)) return '';
    return data[key] !== undefined && data[key] !== null ? String(data[key]) : match;
  });

const renderBlock = (block, data) => {
  const style = block.style || {};

  const baseStyle = `
    padding: ${style.padding || '16px'};
    background-color: ${style.backgroundColor || 'transparent'};
  `;

  switch (block.type) {
    case 'text': {
      const textStyle = `
        ${baseStyle}
        font-size: ${style.fontSize || '16px'};
        color: ${style.textColor || '#1f2937'};
        text-align: ${style.textAlign || 'left'};
        font-weight: ${style.fontWeight || 'normal'};
        line-height: 1.5;
      `;

      const renderedText = renderHandlebars(block.content.text || '', data);

      return `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="${textStyle}">${renderedText}</td>
          </tr>
        </table>
      `;
    }

    case 'image': {
      const imageContainerStyle = `
        ${baseStyle}
        text-align: ${style.textAlign || 'center'};
      `;

      const imageContent = block.content.link
        ? `<a href="${block.content.link}" style="text-decoration: none;">
             <img src="${block.content.src || ''}" alt="${block.content.alt || 'Image'}" style="width: ${block.content.width || '100%'}; max-width: 100%; height: auto; display: block; margin: 0 auto;" />
           </a>`
        : `<img src="${block.content.src || ''}" alt="${block.content.alt || 'Image'}" style="width: ${block.content.width || '100%'}; max-width: 100%; height: auto; display: block; margin: 0 auto;" />`;

      return `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="${imageContainerStyle}">
              ${imageContent}
            </td>
          </tr>
        </table>
      `;
    }

    case 'button': {
      const buttonContainerStyle = `${baseStyle} text-align: center;`;
      const buttonStyle = `
        background-color: ${block.content.backgroundColor || '#3b82f6'};
        color: ${block.content.textColor || '#ffffff'};
        padding: 12px 24px;
        text-decoration: none;
        border-radius: 6px;
        font-size: ${style.fontSize || '16px'};
        font-weight: ${style.fontWeight || '500'};
        display: inline-block;
        border: none;
        cursor: pointer;
      `;

      return `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="${buttonContainerStyle}">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                <tr>
                  <td style="border-radius: 6px; background-color: ${block.content.backgroundColor || '#3b82f6'};">
                    <a href="${block.content.link || '#'}" style="${buttonStyle}">
                      ${block.content.text || 'Button'}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `;
    }

    case 'divider':
      return `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="${baseStyle}">
              <hr style="
                border: none;
                height: ${block.content.height || '1px'};
                background-color: ${block.content.color || '#e2e8f0'};
                margin: 0;
                width: 100%;
              " />
            </td>
          </tr>
        </table>
      `;

    case 'html':
      return `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="${baseStyle}">${block.content.html || ''}</td>
          </tr>
        </table>
      `;

    case 'columns': {
      const columnCount = block.content.columnCount || 2;
      const columnWidth = Math.floor(100 / columnCount);

      return `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="${baseStyle}">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  ${Array.from({ length: columnCount }, (_, index) => {
                    const columnBlocks =
                      block.content.columns && block.content.columns[index]
                        ? block.content.columns[index].map((columnBlock) => renderBlock(columnBlock, data)).join('')
                        : `<div style="border: 1px dashed #ccc; padding: 16px; min-height: 100px; text-align: center; color: #666;">Column ${index + 1}</div>`;

                    return `
                      <td width="${columnWidth}%" style="vertical-align: top; padding: 0 8px;">
                        ${columnBlocks}
                      </td>
                    `;
                  }).join('')}
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `;
    }

    default:
      return `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="${baseStyle}">Unknown block type: ${block.type}</td>
          </tr>
        </table>
      `;
  }
};

const renderTemplate = (template, data = {}) => {
  const blocksHtml = template.content.blocks.map((block) => renderBlock(block, data)).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${template.subject || 'Email'}</title>
      <!--[if mso]>
      <noscript>
        <xml>
          <o:OfficeDocumentSettings>
            <o:PixelsPerInch>96</o:PixelsPerInch>
          </o:OfficeDocumentSettings>
        </xml>
      </noscript>
      <![endif]-->
      <style>
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
        table { border-collapse: collapse !important; }
        body { margin: 0 !important; padding: 0 !important; width: 100% !important; height: 100% !important; }
        .container { max-width: 600px; margin: 0 auto; }
        @media screen and (max-width: 600px) {
          .container { width: 100% !important; max-width: 100% !important; }
          .mobile-padding { padding: 20px !important; }
        }
      </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, sans-serif;">
      ${
        template.preheader
          ? `<div style="display: none; font-size: 1px; color: #fefefe; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">${template.preheader}</div>`
          : ''
      }
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td style="padding: 20px 0;">
            <div class="container" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
              ${blocksHtml}
            </div>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};

module.exports = { renderTemplate, renderHandlebars };
