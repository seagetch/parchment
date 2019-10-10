const electron = require('electron');
const { app, BrowserWindow, ipcMain } = require('electron')

var current_channel = null;

app.on("ready", ()=>{
    let point = electron.screen.getCursorScreenPoint();
    current_screen = electron.screen.getDisplayNearestPoint(point);
    ipcMain.on("start", (event)=>{
        console.log("got start event.")
        current_channel = event;
        current_channel.reply("screen-size", current_screen.bounds)
    });

    console.dir(current_screen.bounds)
    let w = 1200;
    let h = 1024;
    var window = new BrowserWindow({
        width: w, height: h,
        x: current_screen.bounds.x + (current_screen.bounds.width  - w) / 2,
        y: current_screen.bounds.y + (current_screen.bounds.height - h) / 2,
        webPreferences: {
            nodeIntegration: true
        }
    });
    window.loadFile("./src/render/index.html")
    window.on('closed', () => {
        current_channel = null;
        win = null;
    })
    window.setMenuBarVisibility(false);
    window.show();

//    libinput_main();
});

