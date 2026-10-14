import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const startTime = Date.now();
    await page.goto('https://www.google.com/maps/search/soft+toys+manufacturer+delhi?hl=en', { waitUntil: 'networkidle2', timeout: 30000 });

    const results = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));

      const isCompanyMatch = (h1, comp) => {
        if (!h1 || !comp) return false;
        const cleanH1 = h1.toLowerCase().replace(/\b(pvt|ltd|limited|private|enterprises|company|industries|corp|co|inc|llp|traders|manufacturer|manufacturing|store|shop)\b/gi, '').replace(/[^a-z0-9]/g, '');
        const cleanComp = comp.toLowerCase().replace(/\b(pvt|ltd|limited|private|enterprises|company|industries|corp|co|inc|llp|traders|manufacturer|manufacturing|store|shop)\b/gi, '').replace(/[^a-z0-9]/g, '');
        if (!cleanH1 || !cleanComp) {
          const rawH1 = h1.toLowerCase().replace(/[^a-z0-9]/g, '');
          const rawComp = comp.toLowerCase().replace(/[^a-z0-9]/g, '');
          return rawH1 === rawComp || rawH1.includes(rawComp) || rawComp.includes(rawH1);
        }
        return cleanH1 === cleanComp || cleanH1.includes(cleanComp) || cleanComp.includes(cleanH1);
      };

      const ensureFeed = async () => {
        const backBtn = document.querySelector('button[aria-label="Back"], button.hYBOP, button[jsaction*="omnibox.back"], button[jsaction*="pane.back"], button[aria-label*="Back to results" i]');
        if (backBtn && (window.location.href.includes('/maps/place/') || document.querySelector('h1.DUwDvf'))) {
          backBtn.click();
          for (let bw = 0; bw < 15; bw++) {
            await wait(60);
            if (!document.querySelector('h1.DUwDvf') || document.querySelector('div[role="feed"]')) break;
          }
        }
      };

      const list = [];
      const seen = new Set();
      const targetCount = 20;

      for (let scroll = 0; scroll < 25; scroll++) {
        if (list.length >= targetCount) break;

        await ensureFeed();

        const feed = document.querySelector('div[role="feed"]');
        const cards = Array.from(document.querySelectorAll('div.Nv2PK'));

        for (let i = 0; i < cards.length; i++) {
          if (list.length >= targetCount) break;

          const card = cards[i];
          const titleEl = card.querySelector('.fontHeadlineSmall, div.qBF1Pd');
          const companyName = titleEl?.textContent?.trim() || '';
          if (!companyName || seen.has(companyName.toLowerCase())) continue;
          seen.add(companyName.toLowerCase());

          const a = card.querySelector('a.hfpxzc, a[href*="/maps/place/"]');
          const cardOwnText = card.innerText || '';

          // Phone from card
          const phoneMatch = cardOwnText.match(
            /(?:\+?91[\s-]?)?(?:0\d{2,4}[\s-]?)?[2-9]\d{3,4}[\s-]?\d{3,4}\b|(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b|\b1800[\s-]?(?:\d{3}[\s-]?\d{3,4}|\d{2}[\s-]?\d{4})\b/
          );
          let phone = phoneMatch ? phoneMatch[0].trim() : '';

          // Website from card
          let url = '';
          const webEl = card.querySelector('a.lcr4fd, a[data-value="Website"]');
          if (webEl) url = webEl.href || '';

          // Address from card
          let feedAddr = '';
          const lines = cardOwnText.split('\n').map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            if (line.toLowerCase() === companyName.toLowerCase()) continue;
            if (/^[0-9.]+\s*\([0-9,]+\)$/.test(line)) continue;
            const parts = line.split(/[·•|]/).map(p => p.trim()).filter(Boolean);
            for (let part of parts) {
              if (/(?:\+?91|0\d{2,4}|[6-9]\d{9}|1800)/.test(part)) continue;
              if (/^(open|closed|closes|opens|24 hours|in-store|kerbside|delivery|dine-in|temporarily|website|directions|save|share|call|book online)/i.test(part)) continue;
              if (/^(sponsored|ad|promoted|anzeige)$/i.test(part)) continue;
              if (part.length >= 4) {
                feedAddr = part;
                break;
              }
            }
            if (feedAddr) break;
          }

          // Open Place Details
          await ensureFeed();
          card.scrollIntoView({ block: 'center', behavior: 'instant' });
          await wait(50);

          if (a) a.click();
          if (titleEl) titleEl.click();

          let placeAddr = '';
          let placePhone = '';
          let matched = false;

          for (let w = 0; w < 12; w++) {
            await wait(70);
            const h1 = document.querySelector('h1.DUwDvf');
            const h1Text = h1?.textContent?.trim() || '';

            if (h1 && isCompanyMatch(h1Text, companyName)) {
              matched = true;
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

            if (w === 4) {
              if (a) a.click();
              if (titleEl) titleEl.click();
            }
          }

          list.push({
            count: list.length + 1,
            company: companyName,
            matched,
            address: (matched && placeAddr) ? placeAddr : feedAddr,
            phone: (matched && placePhone) ? placePhone : phone
          });

          // Always return to feed immediately so scrolling and next cards work!
          await ensureFeed();
        }

        // Scroll feed to load more cards
        if (feed) {
          feed.dispatchEvent(new WheelEvent('wheel', { deltaY: 2500, bubbles: true }));
          feed.scrollTop += 2500;
          await wait(600);
        }
      }

      return list;
    });

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Extracted ${results.length} leads in ${elapsedSec}s:`);
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
})();
