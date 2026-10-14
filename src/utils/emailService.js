import nodemailer from 'nodemailer';
import { generateDocumentPdfBuffer } from './pdfGenerator.js';

/**
 * PRITTAL DIGITAL - Automated Email & Notification Dispatcher Service
 * Handles dispatching Proforma Invoice (PI), Commercial Tax Invoice, and Payment Receipts
 * to Client Email, Sales Representative Email (Proof of Sale), and Superadmin.
 */

let etherealTestAccount = null;

/**
 * Creates or reuses a Nodemailer transporter.
 * If SMTP credentials exist in process.env, uses real SMTP.
 * Otherwise, creates an Ethereal test account so emails can be previewed live during development.
 */
export const getEmailTransporter = async () => {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  // Real SMTP transport
  if (host && user && pass) {
    return {
      transporter: nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        tls: {
          rejectUnauthorized: false
        }
      }),
      isTest: false,
      from: process.env.EMAIL_FROM || `Prittal Digital Agency <${user}>`
    };
  }

  // Development fallback: Ethereal test SMTP (generates real preview URLs)
  if (!etherealTestAccount) {
    try {
      etherealTestAccount = await nodemailer.createTestAccount();
      console.log('📧 Created Ethereal test email account:', etherealTestAccount.user);
    } catch (e) {
      console.warn('⚠️ Could not create Ethereal test account, falling back to JSON transport:', e.message);
    }
  }

  if (etherealTestAccount) {
    return {
      transporter: nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: etherealTestAccount.user,
          pass: etherealTestAccount.pass
        }
      }),
      isTest: true,
      from: process.env.EMAIL_FROM || `Prittal Digital CRM <${etherealTestAccount.user}>`
    };
  }

  return {
    transporter: nodemailer.createTransport({ jsonTransport: true }),
    isTest: true,
    from: process.env.EMAIL_FROM || 'sales@prittal.com'
  };
};

export const generateInvoiceHtml = ({
  deal,
  client,
  payment,
  salesRep,
  docType = 'PI', // 'PI' | 'PI_PRODUCTION' | 'TAX_INVOICE' | 'RECEIPT'
  customMessage = ''
}) => {
  const isPI = docType === 'PI' || docType === 'PI_PRODUCTION';
  const dealCode = deal.dealCode || deal.sourceDealId || 'DL-2026-0001';
  const docCode = isPI ? `PI-PROD-${dealCode}` : `INV-${dealCode}`;
  const docTitle = isPI ? 'PROFORMA INVOICE & SCOPE AGREEMENT' : 'TAX INVOICE & PAYMENT RECEIPT';
  const paidAmount = Number(payment?.amount) || 0;
  const totalAmount = Number(deal.total) || 0;
  const remainingBalance = Math.max(0, totalAmount - (Number(deal.paidAmount || 0) + (payment ? 0 : 0)));
  const quotaSummary = deal.planSnapshot?.deliverablesQuota?.summary || `${deal.planSnapshot?.includes?.length || 0} Deliverables`;

  // Resolve discount
  const rawSubtotal = Number(deal?.subtotal || 0);
  const rawDiscountVal = Number(deal?.discountValue || deal?.discount || deal?.discountAmount || 0);
  let resolvedDiscount = Number(deal?.discountAmount || 0);
  if (!resolvedDiscount && rawDiscountVal > 0) {
    if (deal?.discountType === 'percentage') {
      resolvedDiscount = Math.round((rawSubtotal * rawDiscountVal) / 100);
    } else {
      resolvedDiscount = rawDiscountVal;
    }
  }
  if (!resolvedDiscount && rawSubtotal > 0 && deal?.total !== undefined && deal?.gstAmount !== undefined) {
    const impliedTaxable = Math.round(Number(deal.total) - Number(deal.gstAmount));
    if (impliedTaxable < rawSubtotal) {
      resolvedDiscount = rawSubtotal - impliedTaxable;
    }
  }
  const discountLabel = (deal?.discountType === 'percentage' && rawDiscountVal > 0 && rawDiscountVal <= 100)
    ? `Discount (${rawDiscountVal}%):`
    : 'Discount Applied:';

  const includesList = (deal.planSnapshot?.includes || []).map(item => `
    <li style="margin-bottom: 6px; color: #374151; font-size: 13px; line-height: 1.4;">
      <span style="color: #0284c7; font-weight: bold; margin-right: 6px;">•</span> ${item}
    </li>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${docTitle} — ${docCode}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 24px; color: #111827;">
  <div style="max-width: 680px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08); border: 1px solid #e5e7eb;">
    
    <!-- Top Header -->
    <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px 28px; color: #ffffff;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td>
            <div style="font-size: 22px; font-weight: 900; letter-spacing: -0.03em; color: #38bdf8;">
              PRITTAL <span style="color: #ffffff; font-weight: 300;">DIGITAL</span>
            </div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.08em;">
              Performance Marketing & Digital Production Agency
            </div>
          </td>
          <td style="text-align: right;">
            <div style="display: inline-block; background-color: rgba(56, 189, 248, 0.15); border: 1px solid #38bdf8; color: #38bdf8; font-size: 11px; font-weight: 800; padding: 5px 12px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.05em;">
              ${docTitle}
            </div>
            <div style="font-size: 12px; color: #cbd5e1; font-family: monospace; margin-top: 6px;">
              Ref: ${docCode}
            </div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Main Content -->
    <div style="padding: 28px;">
      
      <!-- Greeting & Notice -->
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 18px; font-weight: 800; margin: 0 0 6px 0; color: #0f172a;">
          Dear ${client?.contactPerson || client?.name || client?.companyName || deal.clientName || 'Valued Client'},
        </h2>
        <p style="font-size: 13px; color: #4b5563; margin: 0; line-height: 1.5;">
          ${payment 
            ? `Thank you for your payment of <strong style="color: #0f172a;">₹${paidAmount.toLocaleString('en-IN')}</strong> towards your project agreement. Below is your official copy of the Proforma Invoice (PI) & deliverables scope.`
            : `Please find attached your official commercial scope and Proforma Invoice for <strong style="color: #0f172a;">${deal.title || 'Project Deliverables'}</strong>.`}
        </p>
      </div>

      ${customMessage ? `
      <!-- Custom Message from Sales -->
      <div style="background-color: #eff6ff; border-left: 4px solid #38bdf8; border-radius: 6px; padding: 12px 16px; margin-bottom: 24px; font-size: 13px; color: #1e3a8a; line-height: 1.5;">
        <strong style="color: #0369a1; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 4px;">Note from Account Executive:</strong>
        ${customMessage}
      </div>
      ` : ''}

      <!-- Payment Summary Pill Box -->
      ${payment ? `
      <div style="background-color: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
        <div style="font-size: 11px; font-weight: 800; color: #0284c7; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 12px;">
          Payment Confirmation & Proof of Sale
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Amount Paid:</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 800; color: #10b981; font-size: 15px;">
              ₹${paidAmount.toLocaleString('en-IN')}
            </td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Payment Mode:</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 700; color: #1e293b;">
              ${payment.mode || 'UPI / Bank Transfer'}
            </td>
          </tr>
          ${payment.reference ? `
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Transaction UTR / Ref #:</td>
            <td style="padding: 4px 0; text-align: right; font-family: monospace; font-weight: 700; color: #1e293b;">
              ${payment.reference}
            </td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Payment Date:</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 600; color: #1e293b;">
              ${payment.paidOn || new Date().toISOString().split('T')[0]}
            </td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Remaining Balance:</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 800; color: ${remainingBalance > 0 ? '#f59e0b' : '#10b981'};">
              ₹${remainingBalance.toLocaleString('en-IN')}
            </td>
          </tr>
        </table>
      </div>
      ` : ''}

      <!-- Commercial Breakdown Table -->
      <div style="margin-bottom: 24px;">
        <div style="font-size: 12px; font-weight: 800; color: #374151; text-transform: uppercase; margin-bottom: 8px;">
          Commercial Plan Details
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <tr style="background-color: #f9fafb;">
            <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; color: #4b5563;">Package / Scope</th>
            <th style="padding: 10px 12px; text-align: center; border-bottom: 1px solid #e5e7eb; color: #4b5563;">Billing Cycle</th>
            <th style="padding: 10px 12px; text-align: right; border-bottom: 1px solid #e5e7eb; color: #4b5563;">Amount</th>
          </tr>
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
              <strong>${deal.planSnapshot?.name || deal.title || 'Digital Services'}</strong>
              <div style="font-size: 11px; color: #6b7280; margin-top: 2px;">
                ${quotaSummary}
              </div>
            </td>
            <td style="padding: 12px; text-align: center; border-bottom: 1px solid #e5e7eb; color: #374151;">
              ${deal.planSnapshot?.billingType || 'One-time'}
            </td>
            <td style="padding: 12px; text-align: right; border-bottom: 1px solid #e5e7eb; font-weight: 700;">
              ₹${Number(deal.subtotal || deal.total).toLocaleString('en-IN')}
            </td>
          </tr>
          <tr>
            <td colspan="2" style="padding: 8px 12px; text-align: right; color: #6b7280;">Subtotal:</td>
            <td style="padding: 8px 12px; text-align: right; font-weight: 600;">₹${rawSubtotal.toLocaleString('en-IN')}</td>
          </tr>
          ${resolvedDiscount > 0 ? `
          <tr style="background-color: #f0fdf4;">
            <td colspan="2" style="padding: 8px 12px; text-align: right; color: #166534; font-weight: 700;">${discountLabel}</td>
            <td style="padding: 8px 12px; text-align: right; font-weight: 800; color: #166534;">- ₹${resolvedDiscount.toLocaleString('en-IN')}</td>
          </tr>
          ` : ''}
          <tr>
            <td colspan="2" style="padding: 8px 12px; text-align: right; color: #6b7280;">GST (18%):</td>
            <td style="padding: 8px 12px; text-align: right; font-weight: 600;">₹${Number(deal.gstAmount || 0).toLocaleString('en-IN')}</td>
          </tr>
          <tr style="background-color: #f8fafc;">
            <td colspan="2" style="padding: 10px 12px; text-align: right; font-weight: 800; color: #0f172a; font-size: 14px;">Total Project Value:</td>
            <td style="padding: 10px 12px; text-align: right; font-weight: 900; color: #0284c7; font-size: 15px;">₹${totalAmount.toLocaleString('en-IN')}</td>
          </tr>
        </table>
      </div>

      <!-- Scope of Deliverables -->
      ${deal.planSnapshot?.includes?.length ? `
      <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
        <div style="font-size: 12px; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 10px;">
          Included Deliverables & Scope Checklist
        </div>
        <ul style="margin: 0; padding-left: 18px; list-style-type: none;">
          ${includesList}
        </ul>
      </div>
      ` : ''}

      <!-- Sales Proof & Stakeholder Info -->
      <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; margin-bottom: 20px; font-size: 12px; color: #6b7280;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="vertical-align: top; width: 50%;">
              <strong>Client Details:</strong><br>
              ${client?.companyName || client?.company || client?.name || deal.clientName || 'Client'}<br>
              Email: ${client?.email || 'Registered on file'}<br>
              Phone: ${client?.phone || 'Registered on file'}
            </td>
            <td style="vertical-align: top; width: 50%; text-align: right;">
              <strong>Account / Sales Executive:</strong><br>
              ${salesRep?.name || deal.ownerName || 'Prittal Sales Team'}<br>
              Email: ${salesRep?.email || deal.ownerEmail || 'sales@prittal.com'}<br>
              Verified via Prittal CRM
            </td>
          </tr>
        </table>
      </div>

    </div>

    <!-- Footer -->
    <div style="background-color: #f8fafc; border-top: 1px solid #e5e7eb; padding: 20px 28px; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.5;">
      <div>This is an official commercial document generated by <strong>Prittal Digital CRM System</strong>.</div>
      <div>For any billing queries, please contact your account representative or email us at <strong>billing@prittal.com</strong>.</div>
    </div>

  </div>
</body>
</html>
  `;
};

function docTitle(docType) {
  return docType === 'PI' || docType === 'PI_PRODUCTION' ? 'PROFORMA INVOICE' : 'COMMERCIAL INVOICE';
}

/**
 * Dispatches the PDF / Proforma Invoice / Payment confirmation email to:
 * 1. Client Email
 * 2. Sales Executive Email (Proof of sale)
 * 3. Optional CC recipients
 */
export const sendPaymentAndPIDocumentEmail = async ({
  deal,
  client,
  payment,
  salesRep,
  docType = 'PI',
  clientEmail: overrideClientEmail,
  salesEmail: overrideSalesEmail,
  cc: overrideCc,
  customSubject,
  customMessage
}) => {
  const isPI = docType === 'PI' || docType === 'PI_PRODUCTION';
  const dealCode = deal.dealCode || deal.sourceDealId || 'DL-2026-0001';
  const docCode = isPI ? `PI-PROD-${dealCode}` : `INV-${dealCode}`;
  const defaultSubject = `[${docCode}] Official Scope & Proforma Invoice: ${deal.title || 'Retainer Agreement'} | Prittal Digital`;
  const subject = customSubject || defaultSubject;

  // Resolve client email: prioritize explicit override, then client object contact info, then deal
  const clientEmail = (
    overrideClientEmail ||
    client?.email ||
    client?.contacts?.find(c => c.isPrimary)?.email ||
    client?.contacts?.[0]?.email ||
    deal?.clientEmail ||
    ''
  ).trim();

  // Resolve sales email: prioritize override, then salesRep object, then deal owner
  const salesEmail = (
    overrideSalesEmail ||
    salesRep?.email ||
    deal?.ownerEmail ||
    'sales@prittal.com'
  ).trim();

  const toList = [];
  if (clientEmail && clientEmail.includes('@')) {
    toList.push(clientEmail);
  }

  const ccList = [];
  if (salesEmail && salesEmail.includes('@') && !toList.includes(salesEmail)) {
    ccList.push(salesEmail);
  }

  if (overrideCc) {
    const customAddresses = overrideCc.split(',').map(s => s.trim()).filter(Boolean);
    for (const addr of customAddresses) {
      if (addr.includes('@') && !toList.includes(addr) && !ccList.includes(addr)) {
        ccList.push(addr);
      }
    }
  }

  // If client email was empty, deliver to sales representative as primary so sending does not crash
  if (toList.length === 0 && ccList.length > 0) {
    toList.push(ccList.shift());
  }

  if (toList.length === 0) {
    throw new Error('No valid recipient email address found. Please specify at least one valid client or sales email.');
  }

  const htmlContent = generateInvoiceHtml({
    deal,
    client: {
      ...client,
      email: clientEmail
    },
    payment,
    salesRep: {
      ...salesRep,
      email: salesEmail
    },
    docType,
    customMessage
  });

  const textFallback = `${docTitle(docType)} — Ref: ${docCode}\n` +
    `Client: ${client?.companyName || client?.name || deal?.clientName || 'Client'}\n` +
    `Total: ₹${Number(deal.total || 0).toLocaleString('en-IN')}\n` +
    `${customMessage ? `\nNote: ${customMessage}\n` : ''}\n` +
    `This is an automated commercial document dispatched by Prittal Digital CRM.`;

  // Generate official PDF attachment
  let pdfBuffer = null;
  try {
    pdfBuffer = await generateDocumentPdfBuffer({
      deal,
      client,
      payment,
      salesRep,
      docType
    });
  } catch (pdfErr) {
    console.warn('⚠️ Could not generate PDF attachment:', pdfErr.message);
  }

  // Obtain transporter (real SMTP or Ethereal test account)
  const { transporter, isTest, from } = await getEmailTransporter();

  const mailOptions = {
    from,
    to: toList.join(', '),
    cc: ccList.length > 0 ? ccList.join(', ') : undefined,
    subject,
    text: textFallback,
    html: htmlContent,
    attachments: pdfBuffer ? [
      {
        filename: `${docCode}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ] : []
  };

  const info = await transporter.sendMail(mailOptions);
  const previewUrl = isTest && typeof nodemailer.getTestMessageUrl === 'function'
    ? nodemailer.getTestMessageUrl(info)
    : null;

  console.log(`\n======================================================`);
  console.log(`📧 [EMAIL DISPATCHER] ${subject}`);
  console.log(`📬 To: ${toList.join(', ')} | CC: ${ccList.join(', ')}`);
  console.log(`📋 Document: ${docCode} | Total: ₹${Number(deal.total || 0).toLocaleString('en-IN')}`);
  if (payment) {
    console.log(`💰 Paid: ₹${Number(payment.amount).toLocaleString('en-IN')} via ${payment.mode} (Ref: ${payment.reference || 'N/A'})`);
  }
  if (isTest && previewUrl) {
    console.log(`🔗 Ethereal Test Mail Preview URL: ${previewUrl}`);
  } else if (!isTest) {
    console.log(`✅ Dispatched live via configured SMTP server.`);
  }
  console.log(`======================================================\n`);

  return {
    success: true,
    messageId: info.messageId,
    previewUrl: previewUrl || null,
    isTestAccount: isTest,
    recipients: [...toList, ...ccList],
    toList,
    ccList,
    clientEmail,
    salesEmail,
    docCode,
    subject,
    sentAt: new Date().toISOString()
  };
};
