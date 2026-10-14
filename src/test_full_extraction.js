import puppeteer from 'puppeteer';

async function testFullExtraction() {
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

      // 1. Collect all visible cards from feed
      const cardAnchors = Array.from(document.querySelectorAll('div.Nv2PK a.hfpxzc'));
      const extracted = [];

      for (let i = 0; i < Math.min(6, cardAnchors.length); i++) {
        // Find anchor by index or href in current DOM
        const currentCards = Array.from(document.querySelectorAll('div.Nv2PK'));
        const card = currentCards[i];
        if (!card) break;

        const anchor = card.querySelector('a.hfpxzc, a[href*="/maps/place/"]');
        const titleEl = card.querySelector('.fontHeadlineSmall, div.qBF1Pd');
        const title = titleEl?.textContent?.trim() || anchor?.getAttribute('aria-label') || '';
        const targetHref = anchor?.href;

        // Scroll card into view and click
        anchor.scrollIntoView({ block: 'center' });
        await wait(200);
        anchor.click();

        // Wait for Place Details panel to open (check for button[data-item-id="address"] or h1.DUwDvf)
        let addr = '';
        let phone = '';
        let website = '';
        let placeH1 = '';

        for (let w = 0; w < 30; w++) {
          await wait(100);
          const h1 = document.querySelector('h1.DUwDvf');
          if (h1 && document.querySelector('button[data-item-id="address"], button[data-item-id="oloc"], [data-item-id="address"]')) {
            placeH1 = h1.textContent?.trim() || '';
            const addrBtn = document.querySelector('button[data-item-id="address"], button[aria-label*="Address:" i], [data-item-id="address"]');
            if (addrBtn) {
              const aria = addrBtn.getAttribute('aria-label') || '';
              const txt = addrBtn.querySelector('.Io6YTe, .fontBodyMedium')?.textContent || addrBtn.innerText || '';
              addr = (aria || txt || '').replace(/^Address:\s*/i, '').trim();
            }
            const phoneBtn = document.querySelector('button[data-item-id^="phone:"], button[aria-label*="Phone:" i]');
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

        extracted.push({
          index: i,
          feedTitle: title,
          placeH1,
          fullAddress: addr,
          phone,
          website,
          targetHref
        });

        // Click Back button
        const backBtn = document.querySelector('button[aria-label="Back"], button.hYBOP, button[jsaction*="omnibox.back"]');
        if (backBtn) {
          backBtn.click();
          // Wait for feed to reappear
          for (let bw = 0; bw < 25; bw++) {
            await wait(100);
            if (document.querySelector('div[role="feed"], div.Nv2PK')) break;
          }
        }
      }

      return extracted;
    });

    console.log('Results:', JSON.stringify(results, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

testFullExtraction();
