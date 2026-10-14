import puppeteer from 'puppeteer';

async function testExtensionDeepEnrichment() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto('https://www.google.com/maps/search/Garg+Footwear+Delhi?hl=en', { waitUntil: 'networkidle2', timeout: 30000 });

    const results = await page.evaluate(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));

      // 1. Initial feed cards
      const feedCards = Array.from(document.querySelectorAll('div.Nv2PK')).slice(0, 5).map(c => {
        const titleEl = c.querySelector('.fontHeadlineSmall, div.qBF1Pd');
        const a = c.querySelector('a.hfpxzc, a[href*="/maps/place/"]');
        return {
          company: titleEl?.textContent?.trim() || a?.getAttribute('aria-label') || '',
          mapsUrl: a?.href || ''
        };
      });

      const enriched = [];

      for (let i = 0; i < feedCards.length; i++) {
        const c = feedCards[i];

        // Ensure feed is visible
        if (!document.querySelector('div[role="feed"], div.Nv2PK')) {
          const backBtn = document.querySelector('button[aria-label="Back"], button.hYBOP, button[jsaction*="omnibox.back"]');
          if (backBtn) {
            backBtn.click();
            for (let bw = 0; bw < 25; bw++) {
              await wait(100);
              if (document.querySelector('div[role="feed"], div.Nv2PK')) break;
            }
          }
        }

        // Find target link by mapsUrl
        const allAnchors = Array.from(document.querySelectorAll('div.Nv2PK a.hfpxzc, div.Nv2PK a[href*="/maps/place/"]'));
        let targetAnchor = allAnchors.find(a => a.href === c.mapsUrl);
        if (!targetAnchor && c.mapsUrl) {
          const m = c.mapsUrl.match(/data=([^&?]+)/);
          const dataId = m ? m[1].slice(-16) : '';
          if (dataId) targetAnchor = allAnchors.find(a => a.href && a.href.includes(dataId));
        }
        if (!targetAnchor && allAnchors[i]) {
          targetAnchor = allAnchors[i];
        }

        let fullAddress = '';
        let phone = '';
        let website = '';

        if (targetAnchor) {
          targetAnchor.scrollIntoView({ block: 'center', behavior: 'instant' });
          await wait(150);
          targetAnchor.click();

          // Poll for Place Details
          for (let w = 0; w < 30; w++) {
            await wait(100);
            const addrBtn = document.querySelector('button[data-item-id="address"], button[aria-label*="Address:" i], [data-item-id="address"]');
            const plusCodeBtn = document.querySelector('button[data-item-id="oloc"]');
            const phoneBtn = document.querySelector('button[data-item-id^="phone:"], button[aria-label*="Phone:" i]');

            if (addrBtn || plusCodeBtn || phoneBtn) {
              if (addrBtn) {
                const aria = addrBtn.getAttribute('aria-label') || '';
                const txt = addrBtn.querySelector('.Io6YTe, .fontBodyMedium')?.textContent || addrBtn.innerText || '';
                fullAddress = (aria || txt || '').replace(/^Address:\s*/i, '').trim();
              }
              if (phoneBtn) {
                phone = (phoneBtn.getAttribute('aria-label') || phoneBtn.innerText || '').replace(/^Phone:\s*/i, '').trim();
              }
              const webBtn = document.querySelector('a[data-item-id="authority"]');
              if (webBtn) {
                website = webBtn.href || '';
              }
              break;
            }
          }

          // Return back to feed
          const backBtn = document.querySelector('button[aria-label="Back"], button.hYBOP, button[jsaction*="omnibox.back"]');
          if (backBtn) {
            backBtn.click();
            for (let bw = 0; bw < 25; bw++) {
              await wait(100);
              if (document.querySelector('div[role="feed"], div.Nv2PK')) break;
            }
          }
        }

        enriched.push({
          index: i,
          company: c.company,
          fullAddress,
          phone,
          website
        });
      }

      return enriched;
    });

    console.log('Deep Enrichment Results:', JSON.stringify(results, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

testExtensionDeepEnrichment();
