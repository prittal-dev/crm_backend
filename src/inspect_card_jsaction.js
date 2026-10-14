import puppeteer from 'puppeteer';

async function inspectCardJsaction() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto('https://www.google.com/maps/search/Garg+Footwear+Delhi?hl=en', { waitUntil: 'networkidle2', timeout: 30000 });

    const cardJsactions = await page.evaluate(() => {
      const card = document.querySelectorAll('div.Nv2PK')[1];
      if (!card) return null;

      const elementsWithJsaction = Array.from(card.querySelectorAll('[jsaction]')).map(el => ({
        tag: el.tagName,
        className: el.className,
        jsaction: el.getAttribute('jsaction'),
        href: el.getAttribute('href'),
        aria: el.getAttribute('aria-label')
      }));

      return {
        cardJsaction: card.getAttribute('jsaction'),
        cardClass: card.className,
        elementsWithJsaction
      };
    });

    console.log('Jsactions on Card:', JSON.stringify(cardJsactions, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

inspectCardJsaction();
