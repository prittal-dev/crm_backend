import puppeteer from 'puppeteer';

async function checkPlace() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const url = 'https://www.google.com/maps/place/Garg+footwear/data=!4m7!3m6!1s0x390d07000a4940e5:0xd888441516776ad3!8m2!3d28.7195849!4d77.0924069!16s%2Fg%2F11z6q0yn6g!19sChIJ5UBJCgAHDTkR02p3FhVEiNg?authuser=0&hl=en&g_ep=EgoyMDI2MTAwNy4wIJJjKgBIAVAD&rclk=1';
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const info = await page.evaluate(() => {
      const h1 = document.querySelector('h1.DUwDvf')?.textContent?.trim();
      const allButtons = Array.from(document.querySelectorAll('button')).map(b => ({
        itemId: b.getAttribute('data-item-id'),
        aria: b.getAttribute('aria-label'),
        text: b.innerText?.trim()
      })).filter(b => b.itemId || b.aria);

      const allIo6YTe = Array.from(document.querySelectorAll('.Io6YTe, .fontBodyMedium')).map(el => el.innerText?.trim());

      return {
        h1,
        allButtons,
        allIo6YTe
      };
    });

    console.log('Place Info:', JSON.stringify(info, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

checkPlace();
