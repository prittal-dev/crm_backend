import puppeteer from 'puppeteer';

async function testCards() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto('https://www.google.com/maps/search/Garg+Footwear+Delhi?hl=en', { waitUntil: 'networkidle2', timeout: 30000 });

    const cardDetails = await page.evaluate(async () => {
      const cards = Array.from(document.querySelectorAll('div.Nv2PK'));
      const results = [];

      for (let i = 0; i < Math.min(6, cards.length); i++) {
        const c = cards[i];
        const title = c.querySelector('.fontHeadlineSmall, div.qBF1Pd')?.textContent?.trim();
        const a = c.querySelector('a.hfpxzc, a[href*="/maps/place/"]');
        const href = a?.href;

        // click on card link
        if (a) {
          a.click();
          await new Promise(r => setTimeout(r, 1800));
        }

        const h1 = document.querySelector('h1.DUwDvf')?.textContent?.trim();
        const addrBtn = document.querySelector('button[data-item-id="address"], button[aria-label*="Address:" i], [data-item-id="address"]');
        const addrText = addrBtn ? (addrBtn.getAttribute('aria-label') || addrBtn.innerText?.trim()) : null;
        const plusCodeBtn = document.querySelector('button[data-item-id="oloc"], button[aria-label*="Plus code" i]');
        const plusCodeText = plusCodeBtn ? (plusCodeBtn.getAttribute('aria-label') || plusCodeBtn.innerText?.trim()) : null;
        const phoneBtn = document.querySelector('button[data-item-id^="phone:"], button[aria-label*="Phone:" i]');
        const phoneText = phoneBtn ? (phoneBtn.getAttribute('aria-label') || phoneBtn.innerText?.trim()) : null;

        results.push({
          index: i,
          title,
          href,
          h1,
          addrText,
          plusCodeText,
          phoneText
        });

        // Click back
        const backBtn = document.querySelector('button[aria-label="Back"], button.hYBOP, button[jsaction*="omnibox.back"]');
        if (backBtn) {
          backBtn.click();
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      return results;
    });

    console.log('Cards Details:', JSON.stringify(cardDetails, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

testCards();
