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

    const scrollInfo = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const cards = document.querySelectorAll('div.Nv2PK');
      const firstCard = cards[0];

      // Find scrollable ancestors of firstCard
      const scrollables = [];
      let curr = firstCard;
      while (curr && curr !== document.body) {
        const style = window.getComputedStyle(curr);
        const overflowY = style.overflowY;
        const scrollHeight = curr.scrollHeight;
        const clientHeight = curr.clientHeight;
        if (scrollHeight > clientHeight || ['auto', 'scroll'].includes(overflowY)) {
          scrollables.push({
            tag: curr.tagName,
            role: curr.getAttribute('role'),
            className: curr.className,
            overflowY,
            scrollHeight,
            clientHeight,
            scrollTop: curr.scrollTop
          });
        }
        curr = curr.parentElement;
      }

      // Now scroll the last card into view with mouse wheel over it
      const lastCard = cards[cards.length - 1];
      lastCard.scrollIntoView({ block: 'end', behavior: 'instant' });

      // Find which element changed scrollTop
      const afterScrollables = [];
      curr = firstCard;
      while (curr && curr !== document.body) {
        if (curr.scrollTop > 0) {
          afterScrollables.push({
            tag: curr.tagName,
            role: curr.getAttribute('role'),
            className: curr.className,
            scrollTop: curr.scrollTop
          });
        }
        curr = curr.parentElement;
      }

      return {
        initialScrollables: scrollables,
        afterScrollIntoView: afterScrollables,
        cardCountInitial: cards.length
      };
    });

    console.log('Scroll Info:', JSON.stringify(scrollInfo, null, 2));

    // Now test scrolling using Puppeteer's native mouse wheel over the feed
    const box = await page.$eval('div.Nv2PK', el => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + 50, y: rect.top + 50 };
    });

    console.log('Moving mouse to', box);
    await page.mouse.move(box.x, box.y);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel({ deltaY: 2000 });
      await new Promise(r => setTimeout(r, 1000));
    }

    const countAfterMouseWheel = await page.$$eval('div.Nv2PK', els => els.length);
    console.log('Count after native mouse wheel:', countAfterMouseWheel);

  } finally {
    await browser.close();
  }
})();
