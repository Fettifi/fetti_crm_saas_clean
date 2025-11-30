const { app, BrowserWindow } = require('electron');

function createWindow () {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'FETTI CRM Dashboard',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Your dev server will run on http://localhost:3000
  win.loadURL('http://localhost:3000');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
