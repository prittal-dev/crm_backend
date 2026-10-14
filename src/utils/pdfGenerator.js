import PDFDocument from 'pdfkit';

/**
 * Formats numbers into clean Indian comma numbering (e.g. 50,000)
 */
const formatNumber = (amt) => {
  const num = Math.round(Number(amt || 0));
  return num.toLocaleString('en-IN');
};

/**
 * Draws a 5x5 dot matrix grid
 */
const drawDotGrid = (doc, startX, startY, rows = 5, cols = 5, spacing = 6, radius = 1.4, color = '#00adc8') => {
  doc.save();
  doc.fillColor(color);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      doc.circle(startX + c * spacing, startY + r * spacing, radius).fill();
    }
  }
  doc.restore();
};

/**
 * Draws a clean underline field with a label and its value
 */
const drawUnderlineField = (doc, label, value, startX, endX, y, labelWidth = null) => {
  doc.save();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#111827');
  
  const calculatedLabelW = labelWidth || (doc.widthOfString(label) + 4);
  doc.text(label, startX, y - 1, { lineBreak: false });

  const lineStartX = startX + calculatedLabelW;
  const lineEndX = endX;

  // Draw bottom line
  doc.moveTo(lineStartX, y + 8)
     .lineTo(lineEndX, y + 8)
     .strokeColor('#94a3b8')
     .lineWidth(0.6)
     .stroke();

  // Draw value if present
  if (value) {
    doc.font('Helvetica').fontSize(7.5).fillColor('#0f172a');
    doc.text(String(value), lineStartX + 3, y - 1, {
      width: lineEndX - lineStartX - 6,
      ellipsis: true,
      lineBreak: false
    });
  }
  doc.restore();
};

/**
 * Determines whether a service item should be checked/selected based on the client's purchased plan
 */
export const isServiceIncluded = (bullet, colTitle, deal) => {
  const plan = deal?.planSnapshot || null;
  const rawCategory = (plan?.category || '').toLowerCase().trim();
  const planName = (plan?.name || '').toLowerCase().trim();
  const planCode = (plan?.code || '').toLowerCase().trim();
  const planDesc = (plan?.description || '').toLowerCase().trim();
  const dealTitle = (deal?.title || '').toLowerCase().trim();
  const customItems = (deal?.customLineItems || []).map((i) => (i.description || '').toLowerCase().trim());
  const allCustomText = customItems.join(' ');

  // Determine active domains for this deal
  const isWebPlan = 
    rawCategory === 'website' || 
    planName.includes('website') || 
    planCode.startsWith('web') || 
    allCustomText.includes('website') || 
    allCustomText.includes('web development');

  const isSocialMediaPlan = 
    rawCategory === 'social media' || 
    (planName.includes('social media') && !isWebPlan) || 
    planCode.startsWith('smo') || 
    planCode.startsWith('smm') ||
    allCustomText.includes('social media') ||
    allCustomText.includes('instagram management') ||
    allCustomText.includes('facebook management');

  const isPaidAdsPlan = 
    rawCategory === 'paid campaigns' || 
    (planName.includes('paid') && !isWebPlan) || 
    planCode.startsWith('pc_') || 
    planCode.startsWith('ppc') ||
    allCustomText.includes('meta ads') ||
    allCustomText.includes('google ads') ||
    allCustomText.includes('ppc campaign');

  const isSeoPlan = 
    rawCategory === 'seo' || 
    (planName.includes('seo') && !planName.includes('website') && !isWebPlan) || 
    planCode.startsWith('seo') ||
    allCustomText.includes('seo retainer') ||
    allCustomText.includes('seo optimization') ||
    allCustomText.includes('search engine optimization');

  const isShootPlan = 
    rawCategory === 'product shoots' || 
    (planName.includes('shoot') && !isWebPlan) || 
    planCode.startsWith('shoot') ||
    allCustomText.includes('product shoot') ||
    allCustomText.includes('video production');

  const isDigitalMarketingPlan = 
    rawCategory === 'general' ||
    (planName.includes('digital marketing') && !isWebPlan) ||
    allCustomText.includes('digital marketing') ||
    allCustomText.includes('influencer');

  const b = bullet.toLowerCase().trim();
  const col = colTitle.toLowerCase().trim();

  // 1. Digital Marketing Solution Column
  if (col.includes('digital marketing')) {
    if (b.includes('influencer')) {
      return allCustomText.includes('influencer') || (isDigitalMarketingPlan && planName.includes('influencer'));
    }
    if (b.includes('digital marketing solution')) {
      return isDigitalMarketingPlan;
    }
    return false;
  }

  // 2. Social Media Marketing Column
  if (col.includes('social media')) {
    if (!isSocialMediaPlan && !allCustomText.includes('social') && !allCustomText.includes('instagram') && !allCustomText.includes('facebook')) {
      return false;
    }
    if (b.includes('facebook')) {
      return isSocialMediaPlan || allCustomText.includes('facebook');
    }
    if (b.includes('instagram')) {
      return isSocialMediaPlan || allCustomText.includes('instagram');
    }
    if (b.includes('linkdin') || b.includes('linkedin')) {
      return planName.includes('standard') || planName.includes('premium') || allCustomText.includes('linkedin');
    }
    if (b.includes('youtube')) {
      return planName.includes('premium') || allCustomText.includes('youtube');
    }
    if (b.includes('x marketing') || b.includes('twitter')) {
      return planName.includes('premium') || allCustomText.includes('twitter') || allCustomText.includes('x marketing');
    }
    return false;
  }

  // 3. Paid Advertising & PerformanceMarketing Column
  if (col.includes('paid advertising') || col.includes('performancemarketing')) {
    const hasExplicitAds = isPaidAdsPlan || allCustomText.includes('ads') || allCustomText.includes('ppc');
    const isSocialWithAds = isSocialMediaPlan && (planName.includes('standard') || planName.includes('premium'));

    if (!hasExplicitAds && !isSocialWithAds) {
      return false;
    }

    if (b.includes('meta ads')) {
      return hasExplicitAds || isSocialWithAds;
    }
    if (b.includes('google ads')) {
      return isPaidAdsPlan && (planName.includes('standard') || planName.includes('business') || allCustomText.includes('google'));
    }
    if (b.includes('social media ads')) {
      return hasExplicitAds || isSocialWithAds;
    }
    return false;
  }

  // 4. SEO & AI Search Optimization Column
  if (col.includes('seo') || col.includes('search')) {
    // Only check SEO if this is an actual SEO plan or has explicit SEO custom item
    if (!isSeoPlan) {
      return false;
    }

    if (b.includes('search engine optimization') || b === 'seo') {
      return true;
    }
    if (b.includes('international seo')) {
      return planName.includes('business') || allCustomText.includes('international');
    }
    if (b.includes('geo')) {
      return planName.includes('standard') || planName.includes('business');
    }
    if (b.includes('ai seo')) {
      return planName.includes('business');
    }
    if (b.includes('aeo')) {
      return planName.includes('business');
    }
    if (b.includes('e-commerce seo')) {
      return allCustomText.includes('e-commerce') || planDesc.includes('e-commerce');
    }
    return false;
  }

  // 5. Web & E-Commerce Solution Column
  if (col.includes('web') || col.includes('commerce')) {
    if (!isWebPlan) {
      return false;
    }

    if (b.includes('website design')) {
      return true;
    }
    if (b.includes('e-commerce website')) {
      return planName.includes('premium') || planName.includes('commerce') || allCustomText.includes('commerce') || allCustomText.includes('shopify');
    }
    if (b.includes('marketplace')) {
      return allCustomText.includes('marketplace') || allCustomText.includes('amazon');
    }
    return false;
  }

  // 6. Brand, Media & Reputation Management Column
  if (col.includes('brand') || col.includes('reputation') || col.includes('media')) {
    if (!isShootPlan && !allCustomText.includes('media') && !allCustomText.includes('pr') && !allCustomText.includes('shoot')) {
      return false;
    }

    if (b.includes('corporate films') || b.includes('video production')) {
      return isShootPlan || allCustomText.includes('shoot') || allCustomText.includes('film');
    }
    if (b.includes('event')) {
      return allCustomText.includes('event');
    }
    if (b.includes('pr management')) {
      return allCustomText.includes('pr') || allCustomText.includes('reputation');
    }
    return false;
  }

  return false;
};

/**
 * Generates an official, beautifully styled PDF document buffer matching the exact Prittal 2-page template
 * @param {Object} data - Contains deal, client, payment, salesRep, docType
 * @returns {Promise<Buffer>} Resolves to a PDF Buffer ready for email attachment or download
 */
export const generateDocumentPdfBuffer = (data) => {
  return new Promise((resolve, reject) => {
    try {
      const { deal, client, payment, salesRep, docType = 'PI' } = data;
      const isPI = docType === 'PI' || docType === 'PI_PRODUCTION';
      const dealCode = deal?.dealCode || deal?.sourceDealId || 'DL-2026-0001';
      const docCode = isPI ? `PI-${dealCode}` : `INV-${dealCode}`;

      // A4: 595.28 x 841.89 pt
      const PAGE_W = 595.28;
      const PAGE_H = 841.89;

      const doc = new PDFDocument({
        margin: 0,
        size: 'A4',
        autoFirstPage: true
      });

      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const cyan = '#00adc8';
      const darkText = '#111827';
      const grayText = '#334155';
      const lightBorder = '#00adc8';

      // =========================================================================
      // PAGE 1: PROFORMA INVOICE & ORDER SPECIFICATIONS
      // =========================================================================

      // 1. Top Decorative Dot Matrix Grids
      drawDotGrid(doc, 35, 20, 5, 5, 6, 1.4, cyan);
      drawDotGrid(doc, 532, 20, 5, 5, 6, 1.4, cyan);

      // 2. Center Brand Logo: "Prittal."
      doc.font('Helvetica-Bold').fontSize(42);
      const titleStr = 'Prittal';
      const dotStr = '.';
      const titleW = doc.widthOfString(titleStr);
      const dotW = doc.widthOfString(dotStr);
      const logoX = (PAGE_W - (titleW + dotW)) / 2;
      const logoY = 16;

      doc.fillColor(darkText).text(titleStr, logoX, logoY, { lineBreak: false });
      doc.fillColor(cyan).text(dotStr, logoX + titleW, logoY);

      // 3. Sub-header bar
      const subHeaderY = 72;
      // GSTIN NO on left
      doc.font('Helvetica-Bold').fontSize(9).fillColor(cyan).text('GSTIN NO : ', 35, subHeaderY, { lineBreak: false });
      doc.fillColor(darkText).text('07AAJCP9381M1ZL');

      // PERFORMA INVOICE NO on right
      doc.font('Helvetica-Bold').fontSize(9).fillColor(cyan).text('PERFORMA INVOICE NO: ', 330, subHeaderY, { lineBreak: false });
      doc.fillColor(darkText).text(docCode);

      // Date on right line 2
      const invoiceDate = deal?.createdAt ? new Date(deal.createdAt).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(cyan).text('Date: ', 330, subHeaderY + 14, { lineBreak: false });
      doc.fillColor(darkText).text(invoiceDate);

      // Thin cyan subline
      doc.moveTo(35, subHeaderY + 30).lineTo(560, subHeaderY + 30).strokeColor(cyan).lineWidth(0.8).stroke();

      // 4. Advertiser's Details Section (Exact underline layout)
      const formY = 108;
      const clientName = client?.companyName || client?.name || deal?.clientName || '';
      const clientAddress = client?.billingAddress
        ? [client.billingAddress.street, client.billingAddress.city, client.billingAddress.state].filter(Boolean).join(', ')
        : (client?.address || '');
      const pinCode = client?.billingAddress?.postalCode || client?.postalCode || '';
      const mobileNo = client?.phone || client?.mobile || deal?.clientPhone || '';
      const emailId = client?.email || deal?.clientEmail || '';
      const telephone = client?.telephone || '';
      const tanNo = client?.tanNo || client?.pan || '';
      const gstNo = client?.gstin || '';
      const cityState = [client?.billingAddress?.city || client?.city, client?.billingAddress?.state || client?.state].filter(Boolean).join(' / ');

      // Row 1: Advertiser's Name
      drawUnderlineField(doc, "Advertiser's Name: ", clientName, 35, 560, formY);
      // Row 2: Address
      drawUnderlineField(doc, "Address: ", clientAddress, 35, 560, formY + 16);
      // Row 3: Pin Code, Mobile No, Email Id
      drawUnderlineField(doc, "Pin Code: ", pinCode, 35, 175, formY + 32);
      drawUnderlineField(doc, "Mobile No: ", mobileNo, 185, 335, formY + 32);
      drawUnderlineField(doc, "Email Id: ", emailId, 345, 560, formY + 32);
      // Row 4: Telephone No, Tan No
      drawUnderlineField(doc, "Telephone No. With STD Code: ", telephone, 35, 335, formY + 48);
      drawUnderlineField(doc, "Tan No: ", tanNo, 345, 560, formY + 48);
      // Row 5: GST NO, City/State
      drawUnderlineField(doc, "GST NO : ", gstNo, 35, 305, formY + 64);
      drawUnderlineField(doc, "City/State : ", cityState, 315, 560, formY + 64);

      // 5. SERVICES DETAILS Grid Section (Modern prittal2 layout)
      const gridY = 184;
      const gridW = 525;
      const leftTabW = 48;
      const contentW = gridW - leftTabW;
      const rightX = 35 + leftTabW;

      // Determine active services
      const activeServicesList = [];
      const serviceCols = [
        { title: 'Digital Marketing Solution', bullets: ['Digital Marketing Solution', 'Influencer Marketing Solution'] },
        { title: 'Social media Marketing', bullets: ['Facebook Marketing', 'Instagram Marketing', 'Linkdin Marketing', 'Youtube Marketing', 'X Marketing'] },
        { title: 'Paid Advertising & PerformanceMarketing', bullets: ['Meta Ads Management', 'Google Ads Management', 'Social Media Ads'] },
        { title: 'SEO & AI Search Optimization', bullets: ['Search Engine Optimization (SEO)', 'International SEO', 'GEO (Generative Engine Optimization)', 'AI SEO Service', 'AEO (Answer Engine Optimization)', 'E-Commerce SEO'] },
        { title: 'Web & E-Commerce solution', bullets: ['Website Design & Development', 'E-Commerce Website Development', 'Marketplace Management'] },
        { title: 'Brand, Media & Reputation Management', bullets: ['Corporate Films & Video Production', 'Event Management', 'PR Management'] }
      ];
      serviceCols.forEach((col) => {
        col.bullets.forEach((bullet) => {
          if (isServiceIncluded(bullet, col.title, deal)) {
            activeServicesList.push(bullet);
          }
        });
      });
      if (deal?.customLineItems?.length) {
        deal.customLineItems.forEach((item) => {
          if (item.description && !activeServicesList.includes(item.description)) {
            activeServicesList.push(item.description);
          }
        });
      }

      const packageName = deal?.planSnapshot?.name || deal?.title || 'Standard Plan';
      const categoryLabel = deal?.planSnapshot?.category ? deal.planSnapshot.category.toUpperCase() : (deal?.category ? deal.category.toUpperCase() : 'DIGITAL MARKETING');
      const billingCycle = deal?.billingCycle || deal?.planSnapshot?.billingCycle || 'monthly';
      const cycleLabel = billingCycle === 'annual' ? 'ANNUAL PLAN' : billingCycle === 'one-time' ? 'ONE-TIME PROJECT' : 'MONTHLY RETAINER';

      // Outer container border
      const gridH = 98;
      doc.save();
      doc.roundedRect(35, gridY, gridW, gridH, 4).strokeColor(cyan).lineWidth(0.8).stroke();

      // Left Vertical Cyan Tab
      doc.roundedRect(35, gridY, leftTabW, gridH, 4).fill(cyan);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
      doc.text('SERVICES', 35, gridY + 36, { width: leftTabW, align: 'center' });
      doc.text('DETAILS', 35, gridY + 48, { width: leftTabW, align: 'center' });

      // Right Content Area: Top Sub-Bar
      const subBarY = gridY + 8;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(darkText);
      doc.text(`${categoryLabel} — ${packageName}`, rightX + 10, subBarY, { lineBreak: false });
      const planTitleW = doc.widthOfString(`${categoryLabel} — ${packageName}`);

      // Pill Badge
      const badgeX = rightX + 10 + planTitleW + 8;
      doc.roundedRect(badgeX, subBarY - 1, 75, 11, 3).fill(cyan);
      doc.font('Helvetica-Bold').fontSize(5.8).fillColor('#ffffff').text(cycleLabel, badgeX, subBarY + 1.5, { width: 75, align: 'center' });

      // Active count on far right
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#008ba3');
      doc.text(`✓ ${activeServicesList.length} Selected Services Active`, rightX, subBarY + 1, { width: contentW - 12, align: 'right' });

      // Thin divider
      doc.moveTo(rightX + 10, subBarY + 14).lineTo(35 + gridW - 10, subBarY + 14).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

      // Selected Services Scope text & inline pill badges
      const scopeY = subBarY + 18;
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(cyan).text('SELECTED SERVICES SCOPE:', rightX + 10, scopeY, { lineBreak: false });
      let badgeCurX = rightX + 10 + doc.widthOfString('SELECTED SERVICES SCOPE:') + 6;
      let badgeCurY = scopeY - 1;

      const displayedBadges = activeServicesList.length > 0 ? activeServicesList.slice(0, 5) : ['Full Scope Digital Marketing Retainer'];
      displayedBadges.forEach((svc) => {
        doc.font('Helvetica-Bold').fontSize(5.5);
        const svcW = doc.widthOfString(`✓ ${svc}`) + 8;
        if (badgeCurX + svcW > 35 + gridW - 10) {
          return;
        }
        doc.save();
        doc.roundedRect(badgeCurX, badgeCurY, svcW, 10, 2).fill('#f0fdfa');
        doc.roundedRect(badgeCurX, badgeCurY, svcW, 10, 2).strokeColor('#00adc8').lineWidth(0.4).stroke();
        doc.fillColor(darkText).text(`✓ ${svc}`, badgeCurX + 4, badgeCurY + 2);
        doc.restore();
        badgeCurX += svcW + 4;
      });

      // Deliverables Card Box inside Section 5
      const cardY = scopeY + 14;
      const cardW = contentW - 20;
      const cardH = 46;
      doc.save();
      doc.roundedRect(rightX + 10, cardY, cardW, cardH, 3).fill('#f8fafc');
      doc.roundedRect(rightX + 10, cardY, cardW, cardH, 3).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

      const quota = deal?.planSnapshot?.deliverablesQuota || {};
      const numCreatives = Number(quota.creatives || quota.creativesCount || 0);
      const numReels = Number(quota.aiReels || quota.reels || quota.reelsCount || quota.shorts || 0);
      const numCarousels = Number(quota.carousels || quota.carouselsCount || 0);
      const numKeywords = Number(quota.keywords || 0);
      let deliverableStr = quota.summary || '';
      if (!deliverableStr) {
        if (numCreatives > 0 || numReels > 0) {
          deliverableStr = `${numCreatives} Creatives/mo • ${numReels} Reels/mo • ${numCarousels} Carousels/mo${quota.festival !== false ? ' • Festival: Yes' : ''}`;
        } else if (numKeywords > 0) {
          deliverableStr = `${numKeywords} Target Keywords • Technical Optimization & Monthly Reporting`;
        } else if (deal?.planSnapshot?.includes?.length) {
          deliverableStr = deal.planSnapshot.includes.slice(0, 4).join(' • ');
        } else {
          deliverableStr = 'Dedicated Creative Direction, Digital Assets, Growth Campaign Management, and Reporting.';
        }
      }

      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(darkText).text('Scope Deliverables: ', rightX + 16, cardY + 6, { lineBreak: false });
      doc.font('Helvetica').fontSize(6.5).fillColor(grayText).text(deliverableStr, { width: cardW - 120, lineBreak: false, ellipsis: true });

      const planIncludes = deal?.planSnapshot?.includes || deal?.planSnapshot?.features || [];
      if (planIncludes.length > 0) {
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(cyan).text('Included In Plan: ', rightX + 16, cardY + 18, { lineBreak: false });
        doc.font('Helvetica').fontSize(6.5).fillColor(grayText).text(planIncludes.slice(0, 5).join('   •   '), { width: cardW - 110, lineBreak: false, ellipsis: true });
      }

      doc.restore();
      doc.restore();

      // 6. CUSTOMIZED PACKAGES / SERVICE BRIEF Section
      const briefY = 292;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(cyan).text('CUSTOMIZED PACKAGES / SERVICE BRIEF : ', 35, briefY, { lineBreak: false });
      const briefLabelW = doc.widthOfString('CUSTOMIZED PACKAGES / SERVICE BRIEF : ');
      doc.moveTo(35 + briefLabelW + 4, briefY + 6).lineTo(560, briefY + 6).strokeColor(cyan).lineWidth(0.8).stroke();

      // Line 1: Retainer details
      doc.font('Helvetica').fontSize(6.8).fillColor(darkText).text('Commercial Retainer: ', 35, briefY + 11, { lineBreak: false });
      doc.font('Helvetica-Bold').text(`${categoryLabel} — ${packageName}`, { lineBreak: false });

      // Client Remark Box
      const remarkY = briefY + 22;
      const remarkText = deal?.notes?.trim() || deal?.remark?.trim() || deal?.specialTerms?.trim() || 'No special remarks recorded (Standard SLA execution)';
      doc.save();
      doc.roundedRect(35, remarkY, 525, 17, 3).fill('#f0fdfa');
      doc.roundedRect(35, remarkY, 525, 17, 3).strokeColor('#00adc8').lineWidth(0.4).stroke();
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#008ba3').text('Client Remark: ', 42, remarkY + 4.5, { lineBreak: false });
      doc.font('Helvetica').fontSize(6.5).fillColor(darkText).text(remarkText, { width: 440, lineBreak: false, ellipsis: true });
      doc.restore();

      // Execution Terms Box
      const termsBoxY = remarkY + 20;
      doc.save();
      doc.roundedRect(35, termsBoxY, 525, 18, 3).fill('#f8fafc');
      doc.roundedRect(35, termsBoxY, 525, 18, 3).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(6.2).fillColor(darkText).text('Execution Terms: ', 42, termsBoxY + 4, { lineBreak: false });
      doc.font('Helvetica').fontSize(6.2).fillColor(grayText).text("Production onboarding, creative briefing, and asset deployment commence immediately upon clearance of advance payment and brief sign-off. All deliverables specified above will be executed in accordance with Prittal's commercial service standards.", { width: 440, lineGap: 1 });
      doc.restore();

      // 7. LOWER SECTION: Two Columns (Payment & Acknowledgements vs Amounts & Bank)
      const lowerY = 360;
      const leftColW = 255;
      const rightColX = 305;
      const rightColW = 255;

      // -------------------------------------------------------------
      // LEFT COLUMN: MODE OF PAYMENT & ACKNOWLEDGEMENT
      // -------------------------------------------------------------
      doc.save();
      doc.roundedRect(35, lowerY, 110, 14, 3).fill(cyan);
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff').text('MODE OF PAYMENT', 35, lowerY + 3.5, { width: 110, align: 'center' });
      doc.restore();

      const payFormY = lowerY + 17;
      doc.font('Helvetica').fontSize(6.5).fillColor('#64748b');
      doc.text('A/C Payee cheque / RTGS / NEFT / IMPS / UPI / Card', 35, payFormY);

      const paymentMode = payment?.paymentMode || deal?.paymentTerms || deal?.paymentMode || 'UPI / IMPS';
      drawUnderlineField(doc, 'Selected Mode: ', paymentMode, 35, 290, payFormY + 11);

      const rawSubtotal = Number(deal?.subtotal || deal?.total || 0);
      const rawDiscountVal = Number(deal?.discountValue || deal?.discount || deal?.discountAmount || 0);
      let resolvedDiscount = Number(deal?.discountAmount || 0);
      if (!resolvedDiscount && rawDiscountVal > 0) {
        if (deal?.discountType === 'percentage') {
          resolvedDiscount = Math.round((rawSubtotal * rawDiscountVal) / 100);
        } else {
          resolvedDiscount = rawDiscountVal;
        }
      }
      const taxableBase = Math.max(0, rawSubtotal - resolvedDiscount);
      const gstAmt = Number(deal?.gstAmount || Math.round(taxableBase * 0.18));
      const totalAmt = Number(deal?.total || (taxableBase + gstAmt));
      const receivedAmt = Number(deal?.paidAmount !== undefined ? deal.paidAmount : (payment?.amount || 0));
      const balanceAmt = Math.max(0, totalAmt - receivedAmt);
      const paymentStatusStr = balanceAmt === 0 ? 'Full Payment Received' : receivedAmt > 0 ? `Partial Received (₹${formatNumber(receivedAmt)} Advance)` : 'Full Payment Pending';

      drawUnderlineField(doc, 'Payment Status: ', paymentStatusStr, 35, 290, payFormY + 25);
      drawUnderlineField(doc, 'Drawn in Favour of PRITTAL: ', `Rupees ₹${formatNumber(receivedAmt > 0 ? receivedAmt : totalAmt)}`, 35, 290, payFormY + 39);

      // COMPANY ACKNOWLEDGES Badge
      const ackY = payFormY + 58;
      doc.save();
      doc.roundedRect(35, ackY, 130, 14, 3).fill(cyan);
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff').text('COMPANY ACKNOWLEDGES', 35, ackY + 3.5, { width: 130, align: 'center' });
      doc.restore();

      const ackBullets = [
        'Invoice details and terms have been read and accepted.',
        'Services subject to formal sign-off and advance terms.',
        'All disputes subject to Delhi jurisdiction only.',
        'Standard GST rates apply as per prevailing Govt notifications.'
      ];

      let bulletY = ackY + 17;
      ackBullets.forEach((bullet) => {
        doc.font('Helvetica').fontSize(5.8).fillColor(grayText);
        doc.text(`• ${bullet}`, 38, bulletY, { width: 245, lineGap: 1 });
        bulletY += doc.heightOfString(`• ${bullet}`, { width: 245, lineGap: 1 }) + 2;
      });

      // Name & Designation Underline
      drawUnderlineField(doc, 'Name: ', clientName || 'Authorized Signatory', 35, 250, bulletY + 10);
      drawUnderlineField(doc, 'Designation: ', 'Authorized Signatory', 35, 250, bulletY + 24);

      // -------------------------------------------------------------
      // RIGHT COLUMN: PARTICULARS & BANK DETAILS
      // -------------------------------------------------------------
      const tableX = rightColX;
      const tableW = rightColW;
      const tableHeaderH = 16;
      const rowH = 15;

      // Table Header
      doc.save();
      doc.roundedRect(tableX, lowerY, tableW, tableHeaderH, 3).fill(cyan);
      doc.font('Helvetica-Bold').fontSize(7.2).fillColor('#ffffff');
      doc.text('PARTICULARS', tableX + 8, lowerY + 4.5);
      doc.text('AMOUNT (INR)', tableX + 130, lowerY + 4.5, { width: 115, align: 'right' });
      doc.restore();

      const tableRows = [];
      if (resolvedDiscount > 0) {
        tableRows.push({ label: 'Package Standard Price', value: `₹${formatNumber(rawSubtotal)}`, strike: true });
        tableRows.push({ label: 'Special Discount / Offer', value: `- ₹${formatNumber(resolvedDiscount)}`, isDiscount: true });
        tableRows.push({ label: 'Net Taxable Base Amount', value: `₹${formatNumber(taxableBase)}`, bold: true });
      } else {
        tableRows.push({ label: 'Taxable Base Amount', value: `₹${formatNumber(taxableBase)}` });
      }
      tableRows.push({ label: 'GST ( 18% )', value: `+ ₹${formatNumber(gstAmt)}` });
      tableRows.push({ label: 'Total Amount (Incl. GST)', value: `₹${formatNumber(totalAmt)}`, isTotal: true });
      tableRows.push({ label: 'Received Amount', value: `₹${formatNumber(receivedAmt)}${receivedAmt > 0 && balanceAmt > 0 ? ' (Advance)' : ''}`, isReceived: true });
      tableRows.push({ label: 'Balance Amount', value: `₹${formatNumber(balanceAmt)}`, isBalance: true });

      let curRowY = lowerY + tableHeaderH;
      tableRows.forEach((row) => {
        doc.save();
        if (row.isTotal) {
          doc.rect(tableX, curRowY, tableW, rowH).fill('#f8fafc');
        } else if (row.isDiscount) {
          doc.rect(tableX, curRowY, tableW, rowH).fill('#ecfdf5');
        } else if (row.isBalance) {
          doc.rect(tableX, curRowY, tableW, rowH).fill(balanceAmt === 0 ? '#ecfdf5' : '#fffbeb');
        }
        doc.rect(tableX, curRowY, tableW, rowH).strokeColor('#cbd5e1').lineWidth(0.4).stroke();

        doc.font(row.bold || row.isTotal || row.isBalance ? 'Helvetica-Bold' : 'Helvetica').fontSize(6.5);
        if (row.isTotal) doc.fillColor(cyan);
        else if (row.isDiscount) doc.fillColor('#047857');
        else if (row.isBalance) doc.fillColor(balanceAmt === 0 ? '#065f46' : '#92400e');
        else doc.fillColor(darkText);

        doc.text(row.label, tableX + 8, curRowY + 4);
        doc.text(row.value, tableX + 130, curRowY + 4, { width: 115, align: 'right' });
        doc.restore();
        curRowY += rowH;
      });

      // BANK DETAILS (BENEFICIARY)
      const bankY = curRowY + 8;
      const bankH = 58;
      doc.save();
      doc.roundedRect(tableX, bankY, tableW, bankH, 4).fill('#f8fafc');
      doc.roundedRect(tableX, bankY, tableW, bankH, 4).strokeColor(cyan).lineWidth(0.6).stroke();

      // Top cyan tag
      doc.roundedRect(tableX + 8, bankY + 6, 120, 11, 2).fill(cyan);
      doc.font('Helvetica-Bold').fontSize(5.8).fillColor('#ffffff').text('BANK DETAILS (BENEFICIARY)', tableX + 8, bankY + 8.5, { width: 120, align: 'center' });

      const bankFields = [
        { label: 'Name:', val: 'PRITTAL CREATIVE AGENCY PVT LTD' },
        { label: 'Account No:', val: '036705501472' },
        { label: 'IFSC Code:', val: 'ICIC0000367' },
        { label: 'Bank & Branch:', val: 'ICICI Bank, Rohini sec 11' }
      ];

      let bFieldY = bankY + 21;
      bankFields.forEach((bf) => {
        doc.font('Helvetica-Bold').fontSize(5.8).fillColor('#64748b').text(bf.label, tableX + 8, bFieldY, { lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(5.8).fillColor(darkText).text(`  ${bf.val}`);
        bFieldY += 8.5;
      });
      doc.restore();

      // Digital Validation Bar
      const authBarY = lowerY + 295;
      doc.save();
      doc.roundedRect(35, authBarY, 525, 20, 4).fill('#f8fafc');
      doc.roundedRect(35, authBarY, 525, 20, 4).strokeColor('#e2e8f0').lineWidth(0.6).stroke();
      doc.circle(46, authBarY + 10, 4).fill(cyan);
      doc.strokeColor('#ffffff').lineWidth(0.8).moveTo(44, authBarY + 10).lineTo(45.5, authBarY + 12).lineTo(48.5, authBarY + 8).stroke();

      doc.font('Helvetica-Bold').fontSize(6).fillColor(darkText).text('Computer Generated Proforma Invoice: ', 56, authBarY + 6.5, { lineBreak: false });
      doc.font('Helvetica').fontSize(6).fillColor(grayText).text(`Authenticated and processed electronically for ${clientName}. No physical signature or stamp is required.`);

      // Digitally Authorized Badge
      doc.roundedRect(475, authBarY + 4, 75, 12, 3).fill('#ffffff');
      doc.roundedRect(475, authBarY + 4, 75, 12, 3).strokeColor(cyan).lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(5.5).fillColor(cyan).text('DIGITALLY AUTHORIZED', 475, authBarY + 7, { width: 75, align: 'center' });
      doc.restore();

      // 8. Bottom Footer Ribbon (Full Width Solid Cyan Banner)
      const footerH = 40;
      const footerY = PAGE_H - footerH; // 801.89
      doc.save();
      doc.rect(0, footerY, PAGE_W, footerH).fill(cyan);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff').text('PRITTAL CREATIVE AGENCY PRIVATE LIMITED', 0, footerY + 8, { width: PAGE_W, align: 'center' });
      doc.font('Helvetica').fontSize(6.2).fillColor('#ffffff');
      const contactText = 'Plot No - 2, 3rd Floor, PSV-IV, Sector-11, Rohini, Delhi - 110085   |   www.prittal.com   |   sales@prittal.com   |   011 47035184';
      doc.text(contactText, 0, footerY + 21, { width: PAGE_W, align: 'center' });
      doc.restore();

      // =========================================================================
      // PAGE 2: OFFICIAL TERMS & CONDITIONS
      // =========================================================================
      doc.addPage({ margin: 0, size: 'A4' });

      // 1. Header: Prittal.
      doc.font('Helvetica-Bold').fontSize(36);
      const tcTitleStr = 'Prittal';
      const tcDotStr = '.';
      const tcTitleW = doc.widthOfString(tcTitleStr);
      const tcDotW = doc.widthOfString(tcDotStr);
      const tcLogoX = (PAGE_W - (tcTitleW + tcDotW)) / 2;
      const tcLogoY = 22;

      doc.fillColor(darkText).text(tcTitleStr, tcLogoX, tcLogoY, { lineBreak: false });
      doc.fillColor(cyan).text(tcDotStr, tcLogoX + tcTitleW, tcLogoY);

      // TERMS & CONDITIONS bar
      const tcBarY = 66;
      doc.moveTo(190, tcBarY + 5).lineTo(235, tcBarY + 5).strokeColor(cyan).lineWidth(1).stroke();
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(cyan).text('TERMS & CONDITIONS', 242, tcBarY, { lineBreak: false });
      const tcBarTextW = doc.widthOfString('TERMS & CONDITIONS');
      doc.moveTo(242 + tcBarTextW + 7, tcBarY + 5).lineTo(405, tcBarY + 5).strokeColor(cyan).lineWidth(1).stroke();

      // Subtext
      doc.font('Helvetica').fontSize(7).fillColor(grayText);
      doc.text('By accepting this proforma invoice, the Advertiser agrees to be bound by the following terms.', 35, tcBarY + 16, { width: PAGE_W - 70, align: 'center' });

      // 2. Dual Column Terms Layout
      const tcCol1X = 35;
      const tcCol1W = 250;
      const tcCol2X = 305;
      const tcCol2W = 255;
      let p2LeftY = 96;
      let p2RightY = 96;

      // Helper to render numbered section
      const renderTcSection = (num, title, items, startX, startY, colWidth) => {
        doc.save();
        // Number badge circle
        doc.circle(startX + 6, startY + 6, 6).fill(cyan);
        doc.font('Helvetica-Bold').fontSize(6).fillColor('#ffffff').text(String(num), startX + 2, startY + 3, { width: 8, align: 'center' });

        // Section Title
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(cyan).text(title, startX + 16, startY + 2);
        
        let curY = startY + 14;
        items.forEach((item) => {
          doc.font('Helvetica').fontSize(5.8).fillColor('#1e293b');
          const isBullet = item.startsWith('• ');
          const textToRender = isBullet ? item : `• ${item}`;
          doc.text(textToRender, startX + 6, curY, { width: colWidth - 8, lineGap: 1.2 });
          curY += doc.heightOfString(textToRender, { width: colWidth - 8, lineGap: 1.2 }) + 2;
        });

        doc.restore();
        return curY + 4; // return next Y
      };

      // LEFT COLUMN SECTIONS (1 to 8)
      p2LeftY = renderTcSection(1, 'Definitions', [
        '"Company" refers to Prittal.',
        '"Advertiser" refers to the person, company, or entity named on this invoice who is purchasing advertising services.'
      ], tcCol1X, p2LeftY, tcCol1W);

      p2LeftY = renderTcSection(2, 'Pricing', [
        'Rates quoted in this invoice apply only to this specific transaction. The Company may revise its rates at any time for future transactions.'
      ], tcCol1X, p2LeftY, tcCol1W);

      p2LeftY = renderTcSection(3, "Advertiser's Content Obligations", [
        'All materials submitted for advertising must be owned by the Advertiser or used with proper legal authorization.',
        'Content must not be obscene, offensive, unlawful, or in violation of any applicable law or regulation.',
        'The Advertiser confirms they either own the products/services being advertised or are duly authorized to use related copy, images, and trademarks.'
      ], tcCol1X, p2LeftY, tcCol1W);

      p2LeftY = renderTcSection(4, "Company's Rights", [
        'The Company may decline to publish any advertisement at its sole discretion and does not guarantee any particular placement or position.',
        'The Company may modify an advertisement if it considers this necessary.',
        'While reasonable care will be taken in publishing submitted information, the Company is not liable for errors or omissions.'
      ], tcCol1X, p2LeftY, tcCol1W);

      p2LeftY = renderTcSection(5, 'Ownership of Creative Work', [
        "Unless agreed otherwise in writing, any artwork or advertisement created by the Company during production remains the Company's exclusive property (excluding the Advertiser's own trademarks/trade name). This artwork may not be reused or reassigned without the Company's prior written consent."
      ], tcCol1X, p2LeftY, tcCol1W);

      p2LeftY = renderTcSection(6, 'Advertising Agencies & Third-Party Clients', [
        'If an agency places an advertisement on behalf of a client ("Ultimate Customer"), the agency confirms it has authority to act on that client\'s behalf and agrees to indemnify the Company against any claims the client may raise.'
      ], tcCol1X, p2LeftY, tcCol1W);

      p2LeftY = renderTcSection(7, 'Changes in Ownership or Authorization', [
        'The Advertiser must notify the Company in writing of any change in ownership or authorization. If payment is not made in full, the Company may suspend or discontinue services at any time.'
      ], tcCol1X, p2LeftY, tcCol1W);

      p2LeftY = renderTcSection(8, 'Indemnification', [
        'The Advertiser agrees to defend and compensate the Company for any claims, losses, or legal costs (including attorney fees) arising from the advertisement content, including third-party intellectual property claims.'
      ], tcCol1X, p2LeftY, tcCol1W);

      // RIGHT COLUMN SECTIONS (9 to 16)
      p2RightY = renderTcSection(9, 'Liability', [
        'The Advertiser is solely responsible for protecting the intellectual property rights in any content they submit.',
        'The Company is not liable for indirect, incidental, or consequential damages (e.g., loss of profit, goodwill, or data) resulting from its services.',
        "The Company's total liability is limited to the amount actually paid by the Advertiser."
      ], tcCol2X, p2RightY, tcCol2W);

      // 10. Cancellations & Refunds with Table
      doc.save();
      doc.circle(tcCol2X + 6, p2RightY + 6, 6).fill(cyan);
      doc.font('Helvetica-Bold').fontSize(6).fillColor('#ffffff').text('10', tcCol2X + 2, p2RightY + 3, { width: 8, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(cyan).text('Cancellations & Refunds', tcCol2X + 16, p2RightY + 2);
      
      const refundTableY = p2RightY + 14;
      const tServiceW = 75;
      const tPolicyW = tcCol2W - tServiceW;

      // Table Header
      doc.rect(tcCol2X, refundTableY, tcCol2W, 14).fill(cyan);
      doc.font('Helvetica-Bold').fontSize(6).fillColor('#ffffff');
      doc.text('Service', tcCol2X + 4, refundTableY + 3);
      doc.text('Cancellation Policy', tcCol2X + tServiceW + 4, refundTableY + 3);

      // Table Rows
      const cancelRows = [
        {
          s: 'General\nadvertising',
          p: '45% of the amount paid is forfeited as a cancellation fee. Further deductions apply proportionally based on advertisement duration already used.'
        },
        {
          s: 'Film\nproduction',
          p: '70% advance required before shooting; 30% due on delivery. No refunds on cancellation.'
        },
        {
          s: 'Event, Travel\n& Celebrity\nManagement',
          p: '100% advance payment required. No refunds or cancellations, including for sponsorships, delegates, exhibitors, visitors, or other event participation.'
        }
      ];

      let cRowY = refundTableY + 14;
      cancelRows.forEach((cr) => {
        doc.font('Helvetica').fontSize(5.2);
        const textH = Math.max(
          doc.heightOfString(cr.s, { width: tServiceW - 8 }),
          doc.heightOfString(cr.p, { width: tPolicyW - 8, lineGap: 1 })
        ) + 6;

        doc.rect(tcCol2X, cRowY, tcCol2W, textH).strokeColor(cyan).lineWidth(0.5).stroke();
        doc.moveTo(tcCol2X + tServiceW, cRowY).lineTo(tcCol2X + tServiceW, cRowY + textH).strokeColor(cyan).lineWidth(0.5).stroke();

        doc.font('Helvetica-Bold').fontSize(5.2).fillColor('#1e293b').text(cr.s, tcCol2X + 4, cRowY + 3, { width: tServiceW - 8 });
        doc.font('Helvetica').fontSize(5.2).fillColor('#1e293b').text(cr.p, tcCol2X + tServiceW + 4, cRowY + 3, { width: tPolicyW - 8, lineGap: 1 });

        cRowY += textH;
      });
      doc.restore();
      p2RightY = cRowY + 6;

      p2RightY = renderTcSection(11, 'Governing Law & Jurisdiction', [
        'This agreement is governed by the laws of India. Any disputes will be resolved exclusively in the courts of Delhi. Verbal commitments made by Company staff are not considered part of this contract.'
      ], tcCol2X, p2RightY, tcCol2W);

      p2RightY = renderTcSection(12, 'Relationship to Other Agreements', [
        "Where a matter is not addressed in this invoice, the Company's standard User Agreement/Terms & Conditions will apply. In case of conflict, this proforma invoice takes precedence."
      ], tcCol2X, p2RightY, tcCol2W);

      p2RightY = renderTcSection(13, 'Correspondence', [
        'All communication to the Advertiser will be sent to the address listed on the invoice. Communication to the Company should be directed to its registered office.'
      ], tcCol2X, p2RightY, tcCol2W);

      p2RightY = renderTcSection(14, 'Scope of Film Production Services', [
        '"Film Production" includes TV commercials, corporate films, web series, TV serials, product/service anchoring, radio jingles, feature films, and photoshoots.'
      ], tcCol2X, p2RightY, tcCol2W);

      p2RightY = renderTcSection(15, "Use of Advertiser's Work", [
        "The Company is authorized to upload and share the Advertiser's work across the Prittal network."
      ], tcCol2X, p2RightY, tcCol2W);

      p2RightY = renderTcSection(16, 'Video Catalog', [
        "Prittal's video catalog entries are short introductory videos made to a fixed format. Customization is not offered. Filming at more than one location for a video bio incurs an additional charge."
      ], tcCol2X, p2RightY, tcCol2W);

      // Page 2 Bottom Footer
      const p2FooterY = 790;
      doc.font('Helvetica-Bold').fontSize(22);
      const tcFootLogoW = doc.widthOfString('Prittal');
      const tcFootDotW = doc.widthOfString('.');
      const tcFootX = (PAGE_W - (tcFootLogoW + tcFootDotW)) / 2;
      doc.fillColor(darkText).text('Prittal', tcFootX, p2FooterY, { lineBreak: false });
      doc.fillColor(cyan).text('.', tcFootX + tcFootLogoW, p2FooterY);

      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(cyan);
      doc.text('PRITTAL CREATIVE AGENCY PRIVATE LIMITED', 35, p2FooterY + 22, { width: PAGE_W - 70, align: 'center' });

      doc.font('Helvetica').fontSize(6.5).fillColor('#64748b');
      doc.text('Plot No. 2, 3rd Floor, PSP-IV, Sector 11, Rohini, Delhi – 110085', 35, p2FooterY + 32, { width: PAGE_W - 70, align: 'center' });

      doc.font('Helvetica-Bold').fontSize(7).fillColor(cyan);
      doc.text('www.prittal.com', 35, p2FooterY + 41, { width: PAGE_W - 70, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
