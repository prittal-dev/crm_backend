import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const xlsxPath = 'e:\\crm\\xml\\1. DM PROJECTS DETAILS - 2026.xlsx';
const outputDir = 'e:\\crm\\xml\\extracted';

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// In Windows powershell: Expand-Archive -Path "..." -DestinationPath "..." -Force
try {
  const cmd = `powershell -Command "Expand-Archive -Path '${xlsxPath}' -DestinationPath '${outputDir}' -Force"`;
  execSync(cmd, { stdio: 'inherit' });
  console.log('Successfully extracted Excel XML files to ' + outputDir);
} catch (err) {
  console.error('Extraction error:', err);
}
