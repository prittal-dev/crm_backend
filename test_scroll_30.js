import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto('https://www.google.com/maps/search/Toy+Manufacturer+Delhi?hl=en', { waitUntil: 'networkidle2', timeout: 30000 });

    const scrollResults = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const log = [];

      const feed = document.querySelector('div[role="feed"]');
      log.push({
        feedExists: !!feed,
        feedTag: feed?.tagName,
        feedClass: feed?.className,
        feedScrollHeight: feed?.scrollHeight,
        feedClientHeight: feed?.clientHeight,
        parentTag: feed?.parentElement?.tagName,
        parentClass: feed?.parentElement?.className,
        parentScrollHeight: feed?.parentElement?.scrollHeight,
        parentClientHeight: feed?.parentElement?.clientHeight,
      });

      for (let s = 1; s <= 10; s++) {
        const cardsBefore = document.querySelectorAll('div.Nv2PK').length;

        // Try different scroll techniques
        if (feed) {
          feed.scrollTop = feed.scrollHeight;
          const lastCard = feed.querySelector('div.Nv2PK:last-child');
          if (lastCard) {
            lastCard.scrollIntoView({ block: 'end', behavior: 'instant' });
          }
          feed.dispatchEvent(new WheelEvent('wheel', { deltaY: 5000, bubbles: true }));
        }

        await wait(1500);

        const cardsAfter = document.querySelectorAll('div.Nv2PK').length;
        log.push({
          scroll: s,
          cardsBefore,
          cardsAfter,
          feedScrollTop: feed?.scrollTop,
          feedScrollHeight: feed?.scrollHeight,
          hasLoading: !!document.querySelector('span[role="progressbar"], div[role="progressbar"], div[aria-label*="Loading"]')
        });

        if (cardsAfter >= 40) break;
      }

      return log;
    });

    console.log('Scroll Results:', JSON.stringify(scrollResults, null, 2));
  } finally {
    await browser.close();
  }
})();
