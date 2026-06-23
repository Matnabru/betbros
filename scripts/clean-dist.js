const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const distPath = path.resolve(projectRoot, 'dist');

if (!distPath.startsWith(projectRoot + path.sep)) {
  throw new Error(`Refusing to clean path outside project: ${distPath}`);
}

fs.rmSync(distPath, { recursive: true, force: true });
