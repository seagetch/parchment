const { ipcRenderer } = require('electron')
const electron = require('electron');
const ref = require('ref-napi');
const fs = require('fs');

const lib_config = JSON.parse(fs.readFileSync('./config/libraries.json', 'utf8'));

const gegl = require('./ffi/gegl')(lib_config);
const LibInput = require('./ffi/libinput')(lib_config);
const mypaint = require('./ffi/libmypaint')(lib_config, gegl);
const RasterImage = require('./rasterlib/image')(gegl);
const RasterLayer = require('./rasterlib/layer')(gegl);
const brush_loader = require('./resources/brushset')(mypaint);
const path = require('path');
const process = require("process");

import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap";

import '@fortawesome/fontawesome-free/js/fontawesome';
import '@fortawesome/fontawesome-free/js/solid';
import '@fortawesome/fontawesome-free/js/regular';

var image;

function run_rasterlib(bounds) {
    image = new RasterImage(bounds.width, bounds.height);
    let base_layer = new RasterLayer(0, 0, bounds.width, bounds.height);
    image.add_layer(base_layer);
    base_layer.lock(gegl.babl_format("Y' u8"), null, (buffer, stride) => {
        var buf2 = ref.reinterpret(buffer, bounds.width*bounds.height, 0);
        buf2.type = ref.types.uint8;
        buf2.fill(255);
    });
    let layer = new RasterLayer(0, 0, bounds.width, bounds.height);
    layer.lock(gegl.babl_format("R'G'B'A u8"), null, (buffer, stride) => {
        var buf2 = ref.reinterpret(buffer, bounds.width*bounds.height, 0);
        buf2.type = ref.types.uint8;
        buf2.fill(0);
    });
    image.add_layer(layer);
    image.select_layer(1);

    blit($("#canvas")[0], true);
}

var move_count = 0;

class StopWatch {
    constructor(sections) {
        this.counts = new Array(sections);
        this.start = new Array(sections);
        this.total = new Array(sections);
        this.id = 0;
    }

    start_watch(id) {
        this.id = id;
        this.start[this.id] = process.hrtime.bigint();
    }
    lap(id) {
        let time = process.hrtime.bigint();
        this.total[id] += time - this.start[this.id];
        this.counts[id]++;
        this.start[id] = time
        this.id = id;
    }
    stop(id) {
        this.lap(id);
    }
    show() {
        for (let c = 0; c <= this.id; c++) {
            console.log(c+":"+ this.counts[c]+"/ avg "+(this.counts[c]? parseFloat(this.total[c]) / 1000.0 / 1000.0 / this.counts[c]: 0).toFixed(2)+"msec")
        }
    }
    clear() {
        for (let c = 0; c < this.counts.length; c++) {
            this.counts[c] = 0;
            this.start[c] = BigInt(0);
            this.total[c] = BigInt(0);
        }
    }
}
var watch = new StopWatch(10);
watch.clear();
function blit(canvas, direct = false, drect=null) {
    let do_blit = () => {
        if (drect && (direct.width == 0 || drect.height == 0))
            return;
        let ctx = canvas.getContext("2d");
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
        watch.start_watch(0);
        image.update_async(rect.x, rect.y, rect.width, rect.height, (x, y, w, h) => {
            console.log("async_done")
            watch.lap(1);
            let rect2 = new gegl.GeglRectangle();
            rect2.x = x;
            rect2.y = y;
            rect2.width = w;
            rect2.height = h;
            image.lock(gegl.babl_format("R'G'B'A u8"), rect2, (buffer, stride) => {
                watch.lap(2);
                var buf2 = ref.reinterpret(buffer, stride * rect2.height, 0);
                let imageData = null;
                if (stride == rect2.width * 4) {
                    imageData = new ImageData(new Uint8ClampedArray(buf2,0,rect2.width * rect2.height * 4), rect2.width, rect2.height);
                    watch.lap(3);
                } else {
                    let data = new Uint8ClampedArray(rect2.width * rect2.height * 4);
                    for (let y = 0; y < rect2.height; y ++)
                        buf2.copy(data, rect2.width * y * 4, stride * y, st * (y + 1));
                    imageData = new ImageData(data, rect2.width, rect2.height);
                    watch.lap(4);
                }
                ctx.putImageData(imageData, rect2.x, rect2.y);
                watch.stop(5);
            });
        });
    };
    if (direct || move_count % 1000 == 0) {
        do_blit();
    } else {
        setImmediate(do_blit)
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
var last_event = {x: 0, y: 0, time: 0}
var min_x = null, min_y = null, max_x = null, max_y = null;
let orig_buffer = null;
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
            min_x = offset_x; min_y = offset_y; max_x = offset_x; max_y = offset_y;
            watch.clear();
            orig_buffer = image.current_layer.clone_buffer();
        } else {
            console.log("motion")
            if (offset_x < min_x) min_x = offset_x;
            if (offset_y < min_y) min_y = offset_y;
            if (max_x < offset_x) max_x = offset_x;
            if (max_y < offset_y) max_y = offset_y;
            let dtime = (tablet.time - last_event.time)/1000.0;
            watch.start_watch(0);
            let rect = new mypaint.MyPaintRectangle();
            mypaint.mypaint_surface_begin_atomic(surface);
            mypaint.mypaint_brush_stroke_to(brush, surface, offset_x, offset_y, tablet.pressure, tablet.tilt_x, tablet.tilt_y, dtime);
            mypaint.mypaint_surface_end_atomic(surface, rect.ref());
            last_event = tablet;
            watch.lap(0);
            blit(canvas, false, rect);
    
            // motion event
        }
    } else {
        if (vector) {
            console.log("release")
            mypaint.mypaint_brush_reset(brush);
            watch.show();
            watch.clear();
            let bounds = new mypaint.MyPaintRectangle();
            bounds.x = min_x;
            bounds.y = min_y;
            bounds.width = max_x - min_x;
            bounds.height = max_y - min_y;
//            image.current_layer.copy_from_buffer(orig_buffer);
            blit(canvas,true, bounds);
            watch.show();
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

let brushes;
function refresh_brushes() {
    $("#brush-palette").html("");
    for (let path in brushes) {
        let b = brushes[path];
        let img = $("<img>").addClass("rounded").attr("src", b.icon).css({"width": 32, "height": 32}).appendTo("#brush-palette");
        img.on("click", (ev) => {
            brush = b.brush;
        })
    }
}

function read_brushes() {
    let brush_path = path.join(process.cwd(), "brushes");
    brushes = brush_loader(brush_path);
    refresh_brushes();
}

function resize_canvas() {
    let canvas = $("#canvas")[0];
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (image)
        blit(canvas, true, null);
}

$(window).on("load", () =>{
    resize_canvas();
    run_gegl();
    ipcRenderer.send("start");
})

$(window).on("resize", resize_canvas);

ipcRenderer.on("screen-size", (event, bounds) => {
    run_rasterlib(bounds);
    run_mypaint();
    run_libinput(bounds);
    read_brushes();
})
