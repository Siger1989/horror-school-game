const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        title: '逃离恐怖教学楼',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // 加载游戏文件
    win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});