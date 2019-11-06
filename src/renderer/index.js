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
import * as format_ora from './rasterlib/format/ora';
const brush_loader = require('./resources/brushset')(mypaint);

import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap";
import "bootstrap-colorpicker/dist/css/bootstrap-colorpicker.css";
import "bootstrap-colorpicker";
// FIXME: mdbootstrap has bug related to bsCustomFileInput.
// To avoid that bug, we need to assign busCustomFileInput manually.
window.bsCustomFileInput = require('bs-custom-file-input');
require("mdbootstrap/css/mdb.css");
require("mdbootstrap");

import '@fortawesome/fontawesome-free/js/fontawesome';
import '@fortawesome/fontawesome-free/js/solid';
import '@fortawesome/fontawesome-free/js/regular';

function on_image_update(image, x, y, w, h) {
    let canvas = $('#canvas')[0];
    let ctx = canvas.getContext("2d");
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
};

var image = null;

function create_new_image(bounds) {
    if (image)
        image.dispose();
    image = new RasterImage(bounds.width, bounds.height);
    let base_layer = new RasterLayer(0, 0, bounds.width, bounds.height);
    let lrect = new gegl.GeglRectangle();
    lrect.x = 0;
    lrect.y = 0;
    lrect.width = bounds.width;
    lrect.height = bounds.height;
    gegl.with_node((top_node)=>{
        let rect  = gegl.node(top_node, {operation: 'gegl:rectangle', x: 0, y:0, width: bounds.width, height: bounds.height, color: gegl.gegl_color_new("rgb(1, 1, 1)")});
        let write = gegl.node(top_node, {operation: 'gegl:write-buffer', buffer: base_layer.buffer});
        rect.output().connect_to(write.input());
        gegl.gegl_buffer_set_extent(base_layer.buffer, write.bounding_box().ref());
        write.process();
    });
    image.add_layer(base_layer);
    let layer = new RasterLayer(0, 0, -1, -1);
    image.add_layer(layer);

    image.on('update', on_image_update);
    image.on('layer-selected', on_update_current_layer);

    image.select_layer(1);
    image.update_all_async();
}

function run_gegl() {
}

var brush;
var gegl_surface;
var surface_extent;
var surface;
var color_fg = [  0,   0,   0];
var color_bg = [  0,   0,   1];

function on_update_current_layer(group, current_layer) {
    if (gegl_surface) {
        mypaint.mypaint_surface_unref(gegl_surface);
        mypaint.mypaint_surface_unref(surface);
    }
    gegl_surface = mypaint.mypaint_gegl_tiled_surface_new();
    mypaint.mypaint_gegl_tiled_surface_set_buffer(gegl_surface, current_layer.buffer);
    surface = mypaint.mypaint_gegl_tiled_surface_interface(gegl_surface);
}

function run_mypaint() {
//    brush = new MypaintBrush(mypaint.mypaint_brush_new());
//    mypaint.mypaint_brush_from_defaults(brush.brush);
}

var grabbed  = false;
var painting = false;
var last_event = {x: 0, y: 0, time: 0}
var min_x = null, min_y = null, max_x = null, max_y = null;
let undo = null;
var move_count = 0;

function tablet_motion(tablet) {
    if (grabbed || !image || !surface || !brush)
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
            undo = new LayerBufferUndo(image, image.current_layer());
            surface_extent = new gegl.GeglRectangle();
            let current_extent = gegl.gegl_buffer_get_extent(image.current_layer().buffer).deref();
            surface_extent.x = current_extent.x;
            surface_extent.y = current_extent.y;
            surface_extent.width = current_extent.width;
            surface_extent.height = current_extent.height;
            undo.start();
            ['.tool-box', '.vertical-tool-box', '.horizontal-tool-box'].forEach((i)=>{
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
            let do_update = () => {
                image.update_async(rect.x, rect.y, rect.width, rect.height);
            }
            if (move_count % 1000 == 0) {
                do_update();
                move_count = 0;
            } else {
                setImmediate(do_update)
            }
            move_count ++;
        }
    } else {
        if (painting) {
            console.log("release"); // release event
            mypaint.mypaint_brush_reset(brush.brush);
            let bounds = new mypaint.MyPaintRectangle();
            surface_extent.combine_with(gegl.gegl_buffer_get_extent(image.current_layer().buffer).deref());
            gegl.gegl_buffer_set_extent(image.current_layer().buffer, surface_extent.ref());
            bounds.x = min_x;
            bounds.y = min_y;
            bounds.width = max_x - min_x;
            bounds.height = max_y - min_y;
            undo.stop(bounds.x, bounds.y, bounds.width, bounds.height);
            image.undos.push(undo);
            undo = null;
            console.log("update "+bounds.x+","+bounds.y+","+bounds.width+","+bounds.height)
            image.update_async(bounds.x, bounds.y, bounds.width, bounds.height);
            ['.tool-box', '.vertical-tool-box',  '.horizontal-tool-box'].forEach((i)=>{
                $(i).css({opacity: 1.0})
            });
            refresh_layers();
        }
        painting = false;
    }
}
var total_dx = null;
var total_dy = null;
function swipe(event) {
    switch (event.event_type) {
        case 'begin':
            total_dx = 0;
            total_dy = 0;
            console.log("swipe: start: "+total_dx+","+total_dy);
            break;
        case 'update':
            total_dx += event.dx;
            total_dy += event.dy;
            break;
        case 'end':
            if (event.cancelled) {

            } else {
                console.log("swipe: total: "+total_dx+","+total_dy);
            }
            break;
    };
};

function run_libinput(screen_size) {
    libinput.current_bounds = screen_size;
    libinput.on("tablet", tablet_motion);
    libinput.on("swipe", swipe)
    libinput.watch();
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
    });

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
    });
    $('#radius-edit').attr({min: brush.setting_info("radius_logarithmic").min, max: brush.setting_info("radius_logarithmic").max, step: "any"}).on("input", (ev)=>{
        brush.base_value("radius_logarithmic", $('#radius-edit').val());
    }).val(brush.base_value("radius_logarithmic"));
    console.log("brush.base_value::r:"+brush.base_value("radius_logarithmic"))
    $('#opacity-edit').attr({min: brush.setting_info("opaque").min, max: brush.setting_info("opaque").max, step: "any"}).on("input", (ev)=>{
        brush.base_value("opaque", $('#opacity-edit').val());
    }).val(brush.base_value("opaque"));
    console.log("brush.base_value::opacity:"+brush.base_value("opaque"));
}

function read_brushes() {
    let brush_path = path.join(process.cwd(), "brushes");
    brushes = brush_loader(brush_path);
    for (let path in brushes) {
        brushes[path].brush = new MypaintBrush(brushes[path].brush);
        if (!brush)
            brush = brushes[path].brush;
    }
    refresh_brushes();
}

function refresh_layers() {
    $("#layer-list").html("");
    for (let i = image.layers.length - 1; i >= 0; i --) {
        let layer = image.layers[i];
        let thumb = layer.thumbnail(48);

        let item = $("<div>").css({width: 50, height: 50, position: "relative"}).addClass("rounded tool-item checkerboard-10").appendTo("#layer-list").attr("layer-index", i);
        let img  = $("<canvas>").css({width: thumb.width, height: thumb.height}).appendTo(item);
        img[0].width  = thumb.width;
        img[0].height = thumb.height;
        if (layer == image.current_layer())
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
            let updated = (image.current_layer() == layer);
            let index = image.layers.indexOf(layer);
            if (index >= 0) {
                image.remove_layer(layer);
                image.undos.push(new layerundo.RemoveLayerUndo(layer, image, index));
                refresh_layers();
            }
            image.update_all_async();
            return false
        });
        visible_btn.on("click",(ev)=>{
            console.log("visible")
            layer.set_visibility(!layer.visible);
            image.update_all_async();
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
        image.update_all_async();
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
    $('.horizontal-tool-box').css({
        'position' : 'fixed',
        'left' : '50%',
        'margin-left' : function() {return -$(this).outerWidth()/2}
    }).dom_resize((elem) => {
        console.log("resize")
        elem.css({
            'position' : 'fixed',
            'left' : '50%',
            'margin-left' : function() {return -elem.outerWidth()/2}
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
    run_mypaint();
    create_new_image(bounds);
    run_libinput(bounds);
    read_brushes();
    refresh_layers();

    $("#file-load").on("click", () =>{
        format_ora.load("test.ora").then((result)=>{
            image.dispose();
            image = result;
            image.on('update', on_image_update);
            image.on('layer-selected', on_update_current_layer);
            refresh_layers();
            image.update_all_async();
        });
    });
    $("#file-save").on("click", () =>{
        format_ora.save(image, "test.ora");
    });

    $("#undo").on("click", ()=>{
        console.log("undo");
        let drect = image.undos.undo();
        refresh_layers();
        if (drect)
            image.update_async(drect.x, drect.y, drect.width, drect.height);
        else
            image.update_all_async();
    });
    $("#redo").on("click", ()=>{
        console.log("redo");
        let drect = image.undos.redo();
        refresh_layers();
        if (drect)
            image.update_async(drect.x, drect.y, drect.width, drect.height);
        else
            image.update_all_async();
    });

    ['.tool-box', '.vertical-tool-box', '.horizontal-tool-box'].forEach((i) => {
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
        let current_layer = image.current_layer();
        let group = current_layer.parent;
        let index = group.layers.indexOf(current_layer) + 1;
        let layer = new RasterLayer(0, 0, -1, -1);
        group.insert_layer(layer, index);
        image.undos.push(new layerundo.InsertLayerUndo(layer, group, index));
        refresh_layers();
    });

    $('#new-file').on("click", ()=>{
        // ToDo: required confirmation if image is modified.
        create_new_image(bounds);
    });
})
