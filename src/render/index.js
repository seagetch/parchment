const { ipcRenderer } = require('electron')

ipcRenderer.on("tablet-motion", (ev, tablet) => {
    let canvas = $("#canvas")[0];
    let client = canvas.getBoundingClientRect();
    let ctx = canvas.getContext("2d");
    ctx.fillStyle="white";
    ctx.beginPath();
    let offset_x = tablet.x - (client.left + window.screenLeft);
    let offset_y = tablet.y - (client.top + window.screenTop);
    console.log("client.x="+client.left+", client.y="+client.top+", pageXOffset="+window.pageXOffset+", pageYOffset="+window.pageYOffset)
    ctx.arc(offset_x, offset_y, 20 * tablet.pressure, 0, Math.PI*2, false);
    ctx.fill();
});

ipcRenderer.send("start");