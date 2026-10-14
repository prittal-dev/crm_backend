import puppeteer from 'puppeteer';

async function testClickTarget() {
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

      const triggerClick = (elem) => {
        if (!elem) return;
        try { elem.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch {}
        try { elem.focus(); } catch {}
        const rect = elem.getBoundingClientRect();
        const x = rect.left + Math.max(5, rect.width / 2);
        const y = rect.top + Math.max(5, rect.height / 2);

        const optsDown = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
        const optsUp = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };

        try { elem.dispatchEvent(new PointerEvent('pointerdown', optsDown)); } catch {}
        try { elem.dispatchEvent(new MouseEvent('mousedown', optsDown)); } catch {}
        try { elem.dispatchEvent(new PointerEvent('pointerup', optsUp)); } catch {}
        try { elem.dispatchEvent(new MouseEvent('mouseup', optsUp)); } catch {}
        try { elem.dispatchEvent(new MouseEvent('click', optsUp)); } catch {}
        try { elem.click(); } catch {}
      };

      const cards = Array.from(document.querySelectorAll('div.Nv2PK')).slice(0, 5);
      const testResults = [];

      for (let i = 0; i < cards.length; i++) {
        const currentCards = Array.from(document.querySelectorAll('div.Nv2PK'));
        const card = currentCards[i];
        if (!card) break;

        const titleEl = card.querySelector('.fontHeadlineSmall, div.qBF1Pd');
        const title = titleEl?.textContent?.trim();

        // Click the title element!
        triggerClick(titleEl || card);

        // Wait until place panel changes
        let fullAddress = '';
        for (let w = 0; w < 30; w++) {
          await wait(100);
          const addrBtn = document.querySelector('button[data-item-id="address"]');
          if (addrBtn) {
            fullAddress = (addrBtn.getAttribute('aria-label') || addrBtn.innerText || '').replace(/^Address:\s*/i, '').trim();
            break;
          }
        }

        testResults.push({
          index: i,
          title,
          fullAddress
        });

        // Click Back
        const backBtn = document.querySelector('button[aria-label="Back"], button.hYBOP');
        if (backBtn) {
          triggerClick(backBtn);
          await wait(800);
        }
      }

      return testResults;
    });

    console.log('Results clicking title:', JSON.stringify(results, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

testClickTarget();
