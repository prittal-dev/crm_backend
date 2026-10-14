import puppeteer from 'puppeteer';

async function testFetchPlace() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto('https://www.google.com/maps/search/Garg+Footwear+Delhi?hl=en', { waitUntil: 'networkidle2', timeout: 30000 });

    const fetchResults = await page.evaluate(async () => {
      const cards = Array.from(document.querySelectorAll('div.Nv2PK'));
      const testHref = cards[1]?.querySelector('a.hfpxzc')?.href;
      if (!testHref) return { error: 'No href found' };

      try {
        const resp = await fetch(testHref);
        const text = await resp.text();

        // Search for address patterns in the HTML response
        const has124507 = text.includes('124507') || text.includes('Bahadurgarh');
        const hasAddress = text.includes('Address:') || text.includes('Plot No');

        // Extract JSON data or APP_INITIALIZATION_STATE
        const matchState = text.match(/window\.APP_INITIALIZATION_STATE\s*=\s*(\[[^;]+\]);/);
        const matchData = text.match(/cacheResponse\s*\(\s*(\[[^;]+\])\s*\)/);

        return {
          status: resp.status,
          textLength: text.length,
          has124507,
          hasAddress,
          hasAppState: !!matchState,
          hasCacheResponse: !!matchData,
          sampleMatch: text.slice(text.indexOf('124507') - 100, text.indexOf('124507') + 100)
        };
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('Fetch Result:', JSON.stringify(fetchResults, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

testFetchPlace();
