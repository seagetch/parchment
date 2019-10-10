const { ipcRenderer } = require('electron')
const electron = require('electron');
const ref = require('ref-napi');
const gegl = require('./ffi/gegl');
const LibInput = require('./ffi/libinput');
const mypaint = require('./ffi/libmypaint');
const RasterImage = require('./rasterlib/image');
const RasterLayer = require('./rasterlib/layer')

var image;

function run_rasterlib() {
    let canvas = $('#canvas')[0]
    image = new RasterImage(canvas.width, canvas.height);
    let base_layer = new RasterLayer(0, 0, canvas.width, canvas.height);
    image.add_layer(base_layer);
    base_layer.lock(gegl.babl_format("Y' u8"), null, (buffer, stride) => {
        var buf2 = ref.reinterpret(buffer, canvas.width*canvas.height, 0);
        buf2.type = ref.types.uint8;
        buf2.fill(255);
    });
    let layer = new RasterLayer(0, 0, canvas.width, canvas.height);
    layer.lock(gegl.babl_format("R'G'B'A u8"), null, (buffer, stride) => {
        var buf2 = ref.reinterpret(buffer, canvas.width*canvas.height, 0);
        buf2.type = ref.types.uint8;
        buf2.fill(0);
    });
    image.add_layer(layer);
    image.select_layer(1);

    blit($("#canvas")[0], true);
}

var dirty = false;
var move_count = 0;
var queued = null;

function blit(canvas, direct = false, drect=null) {
    do_blit = () => {
        if (drect && (direct.width == 0 || drect.height == 0))
            return;
//        if (drect)
//            console.log("rect="+drect.x+","+drect.y+"-"+drect.width+","+drect.height)
//        if (dirty) {
            let ctx = canvas.getContext("2d");
//            let imageData = (!drect)? ctx.getImageData(0, 0, canvas.width, canvas.height): ctx.getImageData(drect.x, drect.y, drect.width, drect.height);
//            let destBuf = Buffer.from(imageData.data.buffer);
//            let destBuf = Buffer.from(imageData.data.buffer);
            let rect = new gegl.GeglRectangle();
            if (!drect) {
                rect.x = 0; rect.y = 0; rect.width = canvas.width; rect.height = canvas.height;
            } else {
                rect.x = drect.x; rect.y = drect.y; rect.width = drect.width; rect.height = drect.height;
                if (rect.x < 0) {
                    rect.width += rect.x;
                    rect.x = 0;
                }
                if (rect.y < 0) {
                    rect.height += rect.y;
                    rect.y = 0;
                }
                if (rect.x + rect.width > canvas.width) {
                    rect.width = canvas.width - rect.x;
                }
                if (rect.y + rect.height > canvas.height) {
                    rect.height = canvas.height - rect.y;
                }
                if (rect.width <= 0 || rect.height <= 0)
                    return;
            }
            if (rect.width == canvas.width && rect.height == canvas.height)
                console.log("update");
            image.update(rect.x, rect.y, rect.width, rect.height);
            if (rect.width == canvas.width && rect.height == canvas.height)
                console.log("locking");
            image.lock(gegl.babl_format("R'G'B'A u8"), rect, (buffer, stride) => {
                var buf2 = ref.reinterpret(buffer, stride * rect.height, 0);
                let imageData = null;
                if (stride == rect.width * 4) {
                    if (rect.width == canvas.width && rect.height == canvas.height)
                       console.log("set image");
    //                    buf2.copy(destBuf, 0, 0, rect.width * rect.height * 4);
                    imageData = new ImageData(new Uint8ClampedArray(buf2,0,rect.width * rect.height * 4), rect.width, rect.height);
                } else {
                    if (rect.width == canvas.width && rect.height == canvas.height)
                       console.log("copy image");
                    let data = new Uint8ClampedArray(rect.width * rect.height * 4);
                    for (let y = 0; y < rect.height; y ++)
                        buf2.copy(data, rect.width * y * 4, stride * y, st * (y + 1));
                    imageData = new ImageData(data, rect.width, rect.height);
                }
                if (rect.width == canvas.width && rect.height == canvas.height)
                    console.log("put image");
                ctx.putImageData(imageData, rect.x, rect.y);
                if (rect.width == canvas.width && rect.height == canvas.height)
                    console.log("done");
            });
            dirty = false;
//        }
        queued = null;
    };
    if (direct || move_count % 1000 == 0) {
        if (queued)
            window.clearTimeout(queued)
        do_blit();
    } else if (!queued) {
        setImmediate(do_blit)
//        queued = window.setTimeout(do_blit, 100);
    }
    move_count ++;
}


function run_gegl() {
    console.log("run_gegl")
    var rect = new gegl.GeglRectangle();
    rect.x = 0, rect.y = 0;
    rect.width = $("#canvas")[0].width
    rect.height = $("#canvas")[0].height
    console.log("Create canvas of size "+rect.width + ","+rect.height)

}

var brush;
var gegl_surface;
var surface;

function run_mypaint() {
    brush = mypaint.mypaint_brush_new();
    mypaint.mypaint_brush_from_defaults(brush);
    gegl_surface = mypaint.mypaint_gegl_tiled_surface_new();
    mypaint.mypaint_gegl_tiled_surface_set_buffer(gegl_surface, image.current_layer.buffer);
    surface = mypaint.mypaint_gegl_tiled_surface_interface(gegl_surface);
}

var vector = null;
var over_node, stroke;
var rendering = false;
var last_event = {x: 0, y: 0, time: 0}
function tablet_motion(ev, tablet) {
    let canvas = $("#canvas")[0];
    let client = canvas.getBoundingClientRect();
    let offset_x = tablet.x - (client.left + window.screenLeft);
    let offset_y = tablet.y - (client.top + window.screenTop);
    if (tablet.pressure > 0) {
        if (!vector) {
            vector = true;
            console.log("press")
            mypaint.mypaint_brush_new_stroke(brush);
            dirty = true;
        } else {
            console.log("motion")
            let dtime = (tablet.time - last_event.time)/1000.0;
            let rect = new mypaint.MyPaintRectangle();
            mypaint.mypaint_surface_begin_atomic(surface);
            mypaint.mypaint_brush_stroke_to(brush, surface, offset_x, offset_y, tablet.pressure, tablet.tilt_x, tablet.tilt_y, dtime);
            mypaint.mypaint_surface_end_atomic(surface, rect.ref());
            last_event = tablet;
            dirty = true;
            blit(canvas, false, rect);
    
            // motion event
        }
    } else {
        if (vector) {
            console.log("release")
            mypaint.mypaint_brush_reset(brush);
            blit(canvas,false);
        }
        vector = false;
    }
}    

var libinput;
function run_libinput(screen_size) {
    libinput = new LibInput(['/dev/input/event3']);
    libinput.current_bounds = screen_size;
    libinput.watch(tablet_motion);
}

$(window).on("load", () =>{
    run_gegl();
    run_rasterlib();
    run_mypaint();
    ipcRenderer.send("start");
})

ipcRenderer.on("screen-size", (event, bounds) => {
    run_libinput(bounds);
})
