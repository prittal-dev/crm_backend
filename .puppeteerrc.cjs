const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Sets cache directory to local .cache folder inside project so Render retains it at runtime
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
