const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const REFRESH_MIN = 30, UPDATE_HOURS = 4;
const CFG = path.join(app.getPath('userData'), 'config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { return null; } };
const writeCfg = c => fs.writeFileSync(CFG, JSON.stringify(c));
let cfg = readCfg();
const getUrl = () => !cfg ? '' : cfg.mode === 'client' ? cfg.url : `http://localhost:${cfg.port || 3000}`;
const hp = (c, s) => crypto.scryptSync(c, s, 32).toString('hex');

process.on('uncaughtException', e => dialog.showErrorBox('خطأ', String(e && e.message || e)));
if (!app.requestSingleInstanceLock()) app.quit();
let win, setup;

function startServer() {
  if (!cfg || cfg.mode !== 'host') return;
  Object.assign(process.env, {
    PORT: String(cfg.port || 3000), HOST: cfg.share ? '0.0.0.0' : '127.0.0.1',
    ADMIN_SALT: cfg.adminSalt, ADMIN_HASH: cfg.adminHash,
    DATA_FILE: path.join(app.getPath('userData'), 'data.json'), PUBLIC_DIR: path.join(__dirname, 'public')
  });
  require('./server.js'); // السيرفر يعمل داخل التطبيق نفسه
}

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 800, minWidth: 900, minHeight: 600, backgroundColor: '#1c1e29',
    title: 'Ministry of Interior', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.on('page-title-updated', e => e.preventDefault());
  const load = () => win.loadURL(getUrl());
  win.webContents.on('did-fail-load', (_e, code, _d, _u, isMain) => {
    if (!isMain || code === -3) return;
    win.loadFile('offline.html'); setTimeout(load, 3000);
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return;
    try { if (new URL(url).origin !== new URL(getUrl()).origin) { e.preventDefault(); shell.openExternal(url); } } catch { e.preventDefault(); }
  });
  load();
  setInterval(() => { if (win && !win.isDestroyed() && !win.isFocused() && win.webContents.getURL().startsWith('http')) win.webContents.reloadIgnoringCache(); }, REFRESH_MIN * 60000);
}

function openSetup(first) {
  if (setup && !setup.isDestroyed()) return setup.focus();
  setup = new BrowserWindow({ width: 480, height: 560, parent: first ? undefined : win, modal: !first, resizable: false, autoHideMenuBar: true,
    backgroundColor: '#1c1e29', title: 'الإعدادات',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  setup.loadFile('settings.html');
  if (first) setup.on('closed', () => { if (!readCfg()) app.quit(); });
}
const ips = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
ipcMain.handle('get-cfg', () => ({ mode: cfg?.mode || 'host', url: cfg?.url || '', port: cfg?.port || 3000, share: !!cfg?.share, hasAdmin: !!cfg?.adminHash, ips: ips() }));
ipcMain.handle('save-cfg', (_e, f) => {
  const n = { mode: f.mode === 'client' ? 'client' : 'host', port: Math.min(65535, Math.max(1024, parseInt(f.port) || 3000)), share: !!f.share, adminSalt: cfg?.adminSalt, adminHash: cfg?.adminHash };
  if (n.mode === 'client') {
    try { const p = new URL(f.url); if (!/^https?:$/.test(p.protocol)) throw 0; n.url = p.origin + (p.pathname === '/' ? '' : p.pathname); } catch { return 'رابط غير صالح'; }
  } else {
    const code = String(f.adminCode || '').trim().toUpperCase();
    if (code) { if (code.length < 5) return 'رمز المدير 5 خانات على الأقل'; n.adminSalt = crypto.randomBytes(8).toString('hex'); n.adminHash = hp(code, n.adminSalt); }
    else if (!n.adminHash) return 'أدخل رمز المدير';
  }
  writeCfg(n); app.relaunch(); app.exit(0); return '';
});

function autoUpdate() {
  if (!app.isPackaged) return;
  try { const { autoUpdater } = require('electron-updater'); autoUpdater.autoInstallOnAppQuit = true;
    const check = () => autoUpdater.checkForUpdatesAndNotify().catch(() => {}); check(); setInterval(check, UPDATE_HOURS * 3600e3); } catch {}
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'التطبيق', submenu: [
    { label: 'تحديث الصفحة', accelerator: 'F5', click: () => win && win.webContents.reloadIgnoringCache() },
    { label: 'الإعدادات', accelerator: 'CmdOrCtrl+,', click: () => openSetup(false) },
    { label: 'ملء الشاشة', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
    { type: 'separator' }, { role: 'quit', label: 'إغلاق' } ] }]));
  if (!cfg) return openSetup(true);
  startServer(); createWindow(); autoUpdate();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
