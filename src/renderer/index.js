const { ipcRenderer } = require('electron')
const ref = require('ref-napi');
const path = require('path');
const process = require("process");

import gegl from './ffi/gegl';
import RasterImage from './rasterlib/image';
import RasterLayer from './rasterlib/layer';
import LayerGroup from './rasterlib/layergroup';
import LayerBufferUndo from './rasterlib/layerbufferundo';
import libinput from './ffi/libinput';
import mypaint, {MypaintBrush} from './ffi/libmypaint';
import * as layerundo from './rasterlib/layerundo';
const brush_loader = require('./resources/brushset')(mypaint);

import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap";
import "bootstrap-colorpicker/dist/css/bootstrap-colorpicker.css";
import "bootstrap-colorpicker";

import '@fortawesome/fontawesome-free/js/fontawesome';
import '@fortawesome/fontawesome-free/js/solid';
import '@fortawesome/fontawesome-free/js/regular';
import { createPublicKey } from 'crypto';

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
        this.clear();
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
        image.update_async(rect.x, rect.y, rect.width, rect.height, (x, y, w, h) => {
            console.log("async_done")
            let rect2 = new gegl.GeglRectangle();
            rect2.x = x;
            rect2.y = y;
            rect2.width = w;
            rect2.height = h;
            image.lock(gegl.babl_format("R'G'B'A u8"), rect2, (buffer, stride) => {
                var buf2 = ref.reinterpret(buffer, stride * rect2.height, 0);
                let imageData = null;
                if (stride == rect2.width * 4) {
                    imageData = new ImageData(new Uint8ClampedArray(buf2,0,rect2.width * rect2.height * 4), rect2.width, rect2.height);
                } else {
                    let data = new Uint8ClampedArray(rect2.width * rect2.height * 4);
                    for (let y = 0; y < rect2.height; y ++)
                        buf2.copy(data, rect2.width * y * 4, stride * y, st * (y + 1));
                    imageData = new ImageData(data, rect2.width, rect2.height);
                }
                ctx.putImageData(imageData, rect2.x, rect2.y);
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
    var rect = new gegl.GeglRectangle();
    rect.x = 0, rect.y = 0;
    rect.width = $("#canvas")[0].width
    rect.height = $("#canvas")[0].height
    console.log("Create canvas of size "+rect.width + ","+rect.height)

}

var brush;
var gegl_surface;
var surface;
var color_fg = [  0,   0,   0];
var color_bg = [  0,   0,   1];

function run_mypaint() {
    brush = new MypaintBrush(mypaint.mypaint_brush_new());
    mypaint.mypaint_brush_from_defaults(brush.brush);
    gegl_surface = mypaint.mypaint_gegl_tiled_surface_new();
    mypaint.mypaint_gegl_tiled_surface_set_buffer(gegl_surface, image.current_layer.buffer);
    surface = mypaint.mypaint_gegl_tiled_surface_interface(gegl_surface);
}

var grabbed  = false;
var painting = false;
var last_event = {x: 0, y: 0, time: 0}
var min_x = null, min_y = null, max_x = null, max_y = null;
let undo = null;
function tablet_motion(ev, tablet) {
    if (grabbed)
        return;
    let canvas = $("#canvas")[0];
    let client = canvas.getBoundingClientRect();
    let offset_x = tablet.x - (client.left + window.screenLeft);
    let offset_y = tablet.y - (client.top + window.screenTop);
    if (tablet.pressure > 0) {
        if (!painting) {
            painting = true;
            console.log("press"); // press event
            brush.base_value("color_h", color_fg[0]);
            brush.base_value("color_s", color_fg[1]);
            brush.base_value("color_v", color_fg[2]);
            mypaint.mypaint_brush_new_stroke(brush.brush);
            min_x = offset_x; min_y = offset_y; max_x = offset_x; max_y = offset_y;
            undo = new LayerBufferUndo(image, image.current_layer);
            undo.start();
            ['.tool-box', '.vertical-tool-box'].forEach((i)=>{
                $(i).css({opacity: 0.3})
            });
        } else {
            console.log("motion"); // motion event
            let dtime = (tablet.time - last_event.time)/1000.0;
            let rect = new mypaint.MyPaintRectangle();
            mypaint.mypaint_surface_begin_atomic(surface);
            mypaint.mypaint_brush_stroke_to(brush.brush, surface, offset_x, offset_y, tablet.pressure, tablet.tilt_x, tablet.tilt_y, dtime);
            mypaint.mypaint_surface_end_atomic(surface, rect.ref());
            if (rect.width > 0 && rect.height > 0) {
                if (rect.x < min_x) min_x = rect.x;
                if (rect.y < min_y) min_y = rect.y;
                if (max_x < rect.x + rect.width) max_x = rect.x + rect.width;
                if (max_y < rect.y + rect.height) max_y = rect.y + rect.height;
            }
            last_event = tablet;
            blit(canvas, false, rect);
        }
    } else {
        if (painting) {
            console.log("release"); // release event
            mypaint.mypaint_brush_reset(brush.brush);
            let bounds = new mypaint.MyPaintRectangle();
            bounds.x = min_x;
            bounds.y = min_y;
            bounds.width = max_x - min_x;
            bounds.height = max_y - min_y;
            undo.stop(bounds.x, bounds.y, bounds.width, bounds.height);
            image.undos.push(undo);
            undo = null;
            console.log("update "+bounds.x+","+bounds.y+","+bounds.width+","+bounds.height)
            blit(canvas,true, bounds);
            ['.tool-box', '.vertical-tool-box'].forEach((i)=>{
                $(i).css({opacity: 1.0})
            });
            refresh_layers();
        }
        painting = false;
    }
}    

function run_libinput(screen_size) {
    libinput.current_bounds = screen_size;
    libinput.watch(tablet_motion);
}

let brushes;
function refresh_brushes() {
    $("#brush-palette").html("");
    for (let path in brushes) {
        let b = brushes[path];
        let img = $("<img>").addClass("rounded").attr("src", b.icon).css({"width": 32, "height": 32}).appendTo("#brush-palette");
        if (brush == b.brush) {
            img.addClass("border border-primary");
        }
        img.on("click", (ev) => {
            brush = b.brush;
            refresh_brushes();
        })
    }
    let fg = $("#color-fg");
    $("input", fg).attr("value", "hsv("+color_fg[0]+","+color_fg[1]+","+color_fg[2]+")");
    fg.colorpicker().on("colorpickerChange", (e)=>{
        color_fg = [e.color.hue / 360, e.color.saturation / 100, e.color.value / 100];
        console.log(color_fg);
    }).on("colorpickerShow", (ev) =>{
        console.log("colorpickerShow");
        grabbed = true;
    }).on("colorpickerHide", (ev) =>{
        console.log("hidePicker");
        grabbed = false;
    })
    let bg = $("#color-bg");
    $("input", bg).attr("value", "hsv("+color_bg[0]+","+color_bg[1]+","+color_bg[2]+")");
    bg.colorpicker().on("colorpickerChange", (e)=>{
        color_bg = [e.color.hue / 360, e.color.saturation / 100, e.color.value / 100];
        console.log(color_bg);
    }).on("colorpickerShow", (ev) =>{
        console.log("colorpickerShow");
        grabbed = true;
    }).on("colorpickerHide", (ev) =>{
        console.log("hidePicker");
        grabbed = false;
    })
}

function read_brushes() {
    let brush_path = path.join(process.cwd(), "brushes");
    brushes = brush_loader(brush_path);
    for (let path in brushes) {
        brushes[path].brush = new MypaintBrush(brushes[path].brush);
    }
    refresh_brushes();
}

function refresh_layers() {
    $("#layer-list").html("");
    for (let i = image.layers.length - 1; i >= 0; i --) {
        let layer = image.layers[i];
        let thumb = layer.thumbnail(48);

        let item = $("<div>").css({width: 50, height: 50, position: "relative"}).addClass("rounded tool-item").appendTo("#layer-list").attr("layer-index", i);
        let img  = $("<canvas>").css({width: thumb.width, height: thumb.height}).appendTo(item);
        img[0].width  = thumb.width;
        img[0].height = thumb.height;
        if (layer == image.current_layer)
            item.addClass("border-primary");

        let delete_btn = $("<div>").addClass("text-white rounded-circle bg-danger").appendTo(item).css({
            position: "absolute", top: 0, right: 0, width: 14, height: 14, padding: 1
        }).hide();
        $("<i>").addClass("fas fa-times fa-sm").appendTo(delete_btn).css({position: "absolute", top: 0, left: 0, width: 14, height: 14});
        let visible_btn = $("<div>").addClass("text-white rounded-circle bg-secondary").appendTo(item).css({
            position: "absolute", top: 0, left: 0, width: 14, height: 14, padding: 1
        }).hide();
        $("<i>").addClass(layer.visible? "fas fa-eye fa-sm": "fas fa-eye-slash fa-sm").appendTo(visible_btn).css({position: "absolute", top: 0, left: 0, width: 14, height: 14});

        item.on("click", (ev)=>{
            console.log("Select layer")
            image.select_layer(i);
            mypaint.mypaint_gegl_tiled_surface_set_buffer(gegl_surface, image.current_layer.buffer);
            refresh_layers();
        }).on("mouseenter", (ev)=>{
            delete_btn.show();
            visible_btn.show();
        }).on("mouseleave", (ev)=>{
            delete_btn.hide();
            visible_btn.hide();
        });

        delete_btn.on("click", (ev)=>{
            console.log("remove layer "+layer)
            let update_current_layer = (image.current_layer == layer);
            let index = image.layers.indexOf(layer);
            if (index >= 0) {
                image.remove_layer(layer);
                image.undos.push(new layerundo.RemoveLayerUndo(layer, image, index));
                refresh_layers();
                if (update_current_layer) {
                    mypaint.mypaint_gegl_tiled_surface_set_buffer(gegl_surface, image.current_layer.buffer);
                }
            }
            blit($('#canvas')[0], true, null);
            return false
        });
        visible_btn.on("click",(ev)=>{
            console.log("visible")
            layer.set_visibility(!layer.visible);
            blit($('#canvas')[0], true);
            refresh_layers();
            return false;
        });

        let ctx = img[0].getContext("2d");
        let imageData = new ImageData(thumb.buffer, thumb.width, thumb.height);
        ctx.putImageData(imageData, 0, 0);
    }
}

function resize_canvas() {
    let canvas = $("#canvas")[0];
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (image)
        blit(canvas, true, null);
}

$.fn.dom_resize = function(callback) {
    for (let i = 0; i < this.length; i ++) {
        let self = this[i];
        let observer = new ResizeObserver((entries)=>{
            console.log("dom_resize")
            for (let e of entries) {
                callback($(e.target));
            }
        });
        observer.observe(self);
        self.observer = observer;
    }
    return this;
}

$(function() {
    $('.vertical-tool-box').css({
        'position' : 'fixed',
        'top' : '50%',
        'margin-top' : function() {return -$(this).outerHeight()/2}
    }).dom_resize((elem) => {
        console.log("resize")
        elem.css({
            'position' : 'fixed',
            'top' : '50%',
            'margin-top' : function() {return -elem.outerHeight()/2}
        })
    });
});

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
    refresh_layers();

    $("#undo").on("click", ()=>{
        console.log("undo");
        let drect = image.undos.undo();
        refresh_layers();
        blit($('#canvas')[0], true, drect);
    });
    $("#redo").on("click", ()=>{
        console.log("redo");
        let drect = image.undos.redo();
        refresh_layers();
        blit($('#canvas')[0], true, drect);
    });

    ['.tool-box', '.vertical-tool-box'].forEach((i) => {
        $(i).on("mouseenter", (ev)=>{
            if (!painting) {
                console.log("suspend");
                libinput.suspend();
            }
            ev.stopPropagation();
        });
        $(i).on("mouseleave", (ev)=>{
            if (!painting) {
                console.log("resume");
                libinput.resume();
            }
        });
    });

    $(document.body).on("mouseenter",(ev) => {
        if (!painting) {
            console.log("resume");
            libinput.resume();
        }
    });
    $(document.body).on("mouseleave", (ev)=>{
        if (!painting) {
            console.log("suspend");
            libinput.suspend();
        }
    });

    $('#add-layer').on("click", () => {
        let index = image.layers.indexOf(image.current_layer);
        let layer = new RasterLayer(0, 0, image.width, image.height);
        image.insert_layer(layer, index + 1);
        image.undos.push(new layerundo.InsertLayerUndo(layer, image, index));
        refresh_layers();
    })
})
