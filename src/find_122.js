import puppeteer from 'puppeteer';

async function findA122() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto('https://www.google.com/maps/search/Garg+Footwear+Delhi?hl=en', { waitUntil: 'networkidle2', timeout: 30000 });

    const data = await page.evaluate(async () => {
      // scroll feed to load 20 cards
      const feed = document.querySelector('div[role="feed"]');
      for (let s = 0; s < 5; s++) {
        if (feed) feed.scrollTop = feed.scrollHeight;
        await new Promise(r => setTimeout(r, 1000));
      }

      const cards = Array.from(document.querySelectorAll('div.Nv2PK'));
      return cards.map(c => {
        const title = c.querySelector('.fontHeadlineSmall, div.qBF1Pd')?.textContent?.trim();
        const fullText = c.innerText?.trim();
        const a = c.querySelector('a.hfpxzc, a[href*="/maps/place/"]');
        return {
          title,
          fullText,
          href: a?.href
        };
      });
    });

    console.log('Found cards:', data.length);
    const a122 = data.filter(d => d.fullText.includes('A-122') || d.fullText.includes('A 122') || d.fullText.includes('122'));
    console.log('Matches with 122:', JSON.stringify(a122, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

findA122();
