const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('./clean-dist');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const entry = path.join(distDir, 'index.js');
const tscEntry = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

let botProcess = null;
let tscProcess = null;
let distWatcher = null;
let restartTimer = null;
let pendingStart = false;
let shuttingDown = false;

function log(message) {
  console.log(`[dev] ${message}`);
}

function pipeOutput(stream) {
  stream.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);

    if (/Found 0 errors/i.test(text)) {
      requestRestart('TypeScript build completed');
    }
  });
}

function ensureDistWatcher() {
  if (distWatcher || !fs.existsSync(distDir)) return;

  try {
    distWatcher = fs.watch(distDir, { recursive: true }, (_eventType, filename) => {
      if (!filename || !/\.(js|json|map)$/.test(String(filename))) return;
      requestRestart(`dist changed: ${filename}`);
    });
    log('Watching dist for changes');
  } catch (err) {
    distWatcher = fs.watch(distDir, (_eventType, filename) => {
      if (!filename || !/\.(js|json|map)$/.test(String(filename))) return;
      requestRestart(`dist changed: ${filename}`);
    });
    log('Watching dist for top-level changes');
  }
}

function startBot() {
  if (!fs.existsSync(entry)) {
    log('Waiting for dist/index.js');
    return;
  }

  if (botProcess && !botProcess.killed) {
    pendingStart = true;
    botProcess.kill();
    return;
  }

  log('Starting bot');
  botProcess = spawn(process.execPath, [entry], {
    cwd: root,
    stdio: 'inherit'
  });

  botProcess.on('exit', (code, signal) => {
    botProcess = null;
    if (shuttingDown) return;

    if (pendingStart) {
      pendingStart = false;
      setTimeout(startBot, 250);
      return;
    }

    log(`Bot exited (${signal || code})`);
  });
}

function requestRestart(reason) {
  ensureDistWatcher();
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    log(`${reason}; restarting bot`);
    startBot();
  }, 500);
}

function startTypeScriptWatch() {
  if (!fs.existsSync(tscEntry)) {
    console.error(`[dev] Could not find TypeScript at ${tscEntry}. Run npm install first.`);
    process.exit(1);
  }

  log('Starting TypeScript watch');
  tscProcess = spawn(process.execPath, [tscEntry, '--watch', '--preserveWatchOutput'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  pipeOutput(tscProcess.stdout);
  pipeOutput(tscProcess.stderr);

  tscProcess.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[dev] TypeScript watch exited (${signal || code})`);
    process.exit(code || 1);
  });
}

function shutdown() {
  shuttingDown = true;
  clearTimeout(restartTimer);
  if (distWatcher) distWatcher.close();
  if (botProcess && !botProcess.killed) botProcess.kill();
  if (tscProcess && !tscProcess.killed) tscProcess.kill();
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

ensureDistWatcher();
startTypeScriptWatch();
