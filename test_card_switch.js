import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto('https://www.google.com/maps/search/soft+toys+manufacturer+delhi?hl=en', { waitUntil: 'networkidle2', timeout: 30000 });

    const results = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      
      const isCompanyMatch = (h1, comp) => {
        if (!h1 || !comp) return false;
        const nh = h1.toLowerCase().replace(/[^a-z0-9]/g, '');
        const nc = comp.toLowerCase().replace(/[^a-z0-9]/g, '');
        return nh === nc || nh.includes(nc) || nc.includes(nh);
      };

      const feed = document.querySelector('div[role="feed"]');
      const cards = Array.from(feed.querySelectorAll('div.Nv2PK'));
      const list = [];

      for (let i = 0; i < Math.min(6, cards.length); i++) {
        // Find card in current feed
        const currentCards = Array.from(document.querySelectorAll('div.Nv2PK'));
        const card = currentCards[i];
        if (!card) continue;

        const titleEl = card.querySelector('.fontHeadlineSmall, div.qBF1Pd');
        const companyName = titleEl?.textContent?.trim() || '';
        const a = card.querySelector('a.hfpxzc, a[href*="/maps/place/"]');
        const cardOwnText = card.innerText || '';

        // Extract phone directly from card's own text
        const phoneMatch = cardOwnText.match(
          /(?:\+?91[\s-]?)?(?:0\d{2,4}[\s-]?)?[2-9]\d{3,4}[\s-]?\d{3,4}\b|(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b|\b1800[\s-]?(?:\d{3}[\s-]?\d{3,4}|\d{2}[\s-]?\d{4})\b/
        );
        let phone = phoneMatch ? phoneMatch[0].trim() : '';

        // Extract address directly from card's own text lines
        const lines = cardOwnText.split('\n').map(l => l.trim()).filter(Boolean);
        let feedAddr = '';
        for (const line of lines) {
          if (line.toLowerCase() === companyName.toLowerCase()) continue;
          if (/^[0-9.]+\s*\([0-9,]+\)$/.test(line)) continue;
          const chunks = line.split(/[·•|]/).map(c => c.trim()).filter(Boolean);
          for (let chunk of chunks) {
            if (/(?:\+?91|0\d{2,4}|[6-9]\d{9}|1800)/.test(chunk)) continue;
            if (/^(open|closed|closes|opens|24 hours|in-store|kerbside|delivery|dine-in|temporarily|website|directions|save|share|call|book online)/i.test(chunk)) continue;
            if (/^(sponsored|ad|promoted|anzeige)$/i.test(chunk)) continue;
            if (/^[0-9.]+(\s*\([0-9,]+\))?$/.test(chunk)) continue;
            if (/^(?:wholesal|manufactur|trader|dealer|supplier|store|shop|factory|distributor|retail|exporter)/i.test(chunk)) continue;
            if (chunk.length >= 4) {
              feedAddr = chunk;
              break;
            }
          }
          if (feedAddr) break;
        }

        // Now scroll card and click it
        card.scrollIntoView({ block: 'center', behavior: 'instant' });
        await wait(100);

        // Click both a and titleEl to guarantee navigation
        if (a) a.click();
        if (titleEl) titleEl.click();

        let placeAddr = '';
        let placePhone = '';
        let placeTitle = '';
        let placeMatched = false;

        // Poll for place details panel matching THIS company name
        for (let w = 0; w < 25; w++) {
          await wait(100);
          const h1 = document.querySelector('h1.DUwDvf');
          const currentH1 = h1?.textContent?.trim() || '';

          // STRICT CHECK: Place details MUST match this exact card's company name!
          if (h1 && isCompanyMatch(currentH1, companyName)) {
            placeMatched = true;
            placeTitle = currentH1;

            const addrBtn = document.querySelector('button[data-item-id="address"], button[aria-label*="Address:" i]');
            if (addrBtn) {
              placeAddr = (addrBtn.getAttribute('aria-label') || addrBtn.innerText || '')
                .replace(/^Address:\s*/i, '')
                .replace(/\bCopy address\b/i, '')
                .trim();
            }

            const phoneBtn = document.querySelector('button[data-item-id^="phone:"], button[aria-label*="Phone:" i]');
            if (phoneBtn) {
              placePhone = (phoneBtn.getAttribute('aria-label') || phoneBtn.innerText || '')
                .replace(/^Phone:\s*/i, '')
                .trim();
            }

            if (placeAddr) break;
          }

          // Retry click at 700ms
          if (w === 7) {
            if (a) a.click();
            if (titleEl) titleEl.click();
          }
        }

        list.push({
          index: i,
          companyName,
          placeMatched,
          placeTitle,
          finalAddress: (placeMatched && placeAddr) ? placeAddr : feedAddr,
          finalPhone: (placeMatched && placePhone) ? placePhone : phone,
          isAddressUnique: true // will verify
        });
      }

      return list;
    });

    console.log('TEST RESULTS:', JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
})();
