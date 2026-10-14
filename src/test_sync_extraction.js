import puppeteer from 'puppeteer';

async function testSyncExtraction() {
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
        const targetHref = anchor?.href || '';

        // Extract unique identifier from targetHref (e.g. data ID or slug)
        const matchData = targetHref.match(/data=([^&?]+)/);
        const dataId = matchData ? matchData[1].slice(-16) : '';
        const slugMatch = targetHref.match(/\/maps\/place\/([^/?]+)/);
        const slug = slugMatch ? slugMatch[1] : '';

        // Scroll into view & click
        anchor.scrollIntoView({ block: 'center' });
        await wait(150);
        anchor.click();

        // Wait until window.location contains the slug/dataId OR h1 matches, AND address/oloc is in DOM
        let addr = '';
        let phone = '';
        let website = '';
        let placeH1 = '';

        for (let w = 0; w < 40; w++) {
          await wait(100);
          const currentUrl = window.location.href;
          const urlMatched = (slug && currentUrl.includes(slug)) || (dataId && currentUrl.includes(dataId));
          const h1 = document.querySelector('h1.DUwDvf');
          const addrBtn = document.querySelector('button[data-item-id="address"], button[aria-label*="Address:" i], [data-item-id="address"]');
          const plusCodeBtn = document.querySelector('button[data-item-id="oloc"]');

          if (urlMatched && h1 && (addrBtn || plusCodeBtn)) {
            placeH1 = h1.textContent?.trim() || '';
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
          website
        });

        // Click Back button
        const backBtn = document.querySelector('button[aria-label="Back"], button.hYBOP, button[jsaction*="omnibox.back"]');
        if (backBtn) {
          backBtn.click();
          for (let bw = 0; bw < 30; bw++) {
            await wait(100);
            if (document.querySelector('div[role="feed"], div.Nv2PK')) break;
          }
        }
      }

      return extracted;
    });

    console.log('Synchronized Results:', JSON.stringify(results, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

testSyncExtraction();
