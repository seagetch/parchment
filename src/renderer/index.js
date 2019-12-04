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
import mypaint, {MypaintBrush, MyPaintBrushModifier} from './ffi/libmypaint';
import * as layerundo from './rasterlib/layerundo';
import * as format_ora from './rasterlib/format/ora';
const brush_loader = require('./resources/brushset')(mypaint);

const $ = require("jquery");
require("jquery-ui-dist/jquery-ui");
require("bootstrap/dist/css/bootstrap.min.css");
require("bootstrap");
require("bootstrap-colorpicker/dist/css/bootstrap-colorpicker.css");
require("bootstrap-colorpicker");
require('@fortawesome/fontawesome-free/js/fontawesome');
require('@fortawesome/fontawesome-free/js/solid');
require('@fortawesome/fontawesome-free/js/regular');
require("mdbootstrap/css/mdb.css");
/*
// FIXME: mdbootstrap has bug related to bsCustomFileInput.
// To avoid that bug, we need to assign busCustomFileInput manually.
//window.bsCustomFileInput = require('bs-custom-file-input');
require("mdbootstrap");
*/

import "./utils"

var color_fg = [  0,   0,   0];
var color_bg = [  0,   0,   1];

var image = null;



function CavnasViewer(canvas, image) {
    let on_image_update = (image, x, y, w, h) => {
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
    image.on('update', on_image_update);
}

function LibInputWatcher(screen_size) {
    libinput.current_bounds = screen_size;
    libinput.watch();
}
class MyPaintBrushOperation {
    constructor(libinput, canvas = null, image = null, layer_list_view = null) {
        this.libinput = libinput;
        this.brushes = [null];
        this.brushes.push(new MyPaintBrushModifier());
        this.brushes.push(new MyPaintBrushModifier({"eraser": 1}));
        this.painting = false;
        this.last_event = {x: 0, y: 0, time: 0}
        this.min_x = null; 
        this.min_y = null;
        this.max_x = null;
        this.max_y = null;
        this.undo = null;
        this.move_count = 0;
        this.gegl_surface = null;
        this.surface_extent = null;
        this.surface = null;
        this.total_dx = null;
        this.total_dy = null;
        this.default_mode = 1;
        if (canvas && image && layer_list_view)
            this.bind(canvas, image, layer_list_view);
    }

    brush(index = 1) {
        if (index == 1) {
            return this.brushes[this.default_mode];
        } else {
            return this.brushes[index];
        }
    }

    set_brush(_brush, tablet_button = 1) {
        if (tablet_button == 1) {
            this.brushes[this.default_mode].bind(_brush);
            this.brushes[this.default_mode].suspend();
        } else {
            this.brushes[tablet_button].bind(_brush);
            this.brushes[tablet_button].suspend();
        }
    }

    bind(canvas, image, layer_list_view) {
        this.dispose();
        if (this.image) {
            try {
                image.off("layer-selected");
            } catch(e) {
                console.log(e);
            }
        }
        if (this.libinput) {
            try {
                this.libinput.off("tablet");
                this.libinput.off("swipe");
            } catch (e) {
                console.log(e);
            }
        }
        this.image = image;
        this.layer_list_view = layer_list_view;
        this.canvas = canvas;
        this.image.on('layer-selected', this.on_change_current_layer.bind(this));
        this.image.select_layer(this.image.current_layer()?-1: 0);
        this.libinput.on("tablet", this.tablet_motion.bind(this));
        this.libinput.on("swipe", this.swipe.bind(this));
    }
    unbind() {
        try {
            this.image.off('layer-selected');
        } catch(e){}
        try {
            this.libinput.off("tablet");
            this.libinput.off("swipe");
        } catch(e) {}
        this.image = null;
        this.layer_list_view = null;
        this.canvas = null;
        this.dispose();
    }
    dispose() {
        if (this.gegl_surface) {
            mypaint.mypaint_surface_unref(this.gegl_surface);
            mypaint.mypaint_surface_unref(this.surface);
            this.gegl_surface = null;
            this.surface = null;
        }
    }

    tablet_motion(tablet) {
        if (!this.image || !this.surface || !this.brush)
            return;
        let client = this.canvas.getBoundingClientRect();
        let offset_x = tablet.x - (client.left + window.screenLeft);
        let offset_y = tablet.y - (client.top + window.screenTop);
        if (tablet.pressure > 0) {
            if (!this.painting) {
                // Press Event
                this.painting = true;
                console.log("resume "+tablet.tool_type);

                this.brush(tablet.tool_type).resume();
                this.brush(tablet.tool_type).base_value("color_h", color_fg[0]);
                this.brush(tablet.tool_type).base_value("color_s", color_fg[1]);
                this.brush(tablet.tool_type).base_value("color_v", color_fg[2]);
                mypaint.mypaint_brush_new_stroke(this.brush(tablet.tool_type).brush);
                this.min_x = offset_x; this.min_y = offset_y; this.max_x = offset_x; this.max_y = offset_y;
                this.undo = new LayerBufferUndo(this.image, this.image.current_layer());
                this.surface_extent = new gegl.GeglRectangle();
                let current_extent = gegl.gegl_buffer_get_extent(this.image.current_layer().buffer).deref();
                this.surface_extent.x = current_extent.x;
                this.surface_extent.y = current_extent.y;
                this.surface_extent.width = current_extent.width;
                this.surface_extent.height = current_extent.height;
                this.undo.start();
                ['.tool-box', '.vertical-tool-box', '.horizontal-tool-box'].forEach((i)=>{
                    $(i).css({opacity: 0.3})
                });
            } else {
                // Motion Event
                let dtime = (tablet.time - this.last_event.time)/1000.0;
                let rect = new mypaint.MyPaintRectangle();
                mypaint.mypaint_surface_begin_atomic(this.surface);
                mypaint.mypaint_brush_stroke_to(this.brush(tablet.tool_type).brush, this.surface, offset_x, offset_y, tablet.pressure, tablet.tilt_x, tablet.tilt_y, dtime);
                mypaint.mypaint_surface_end_atomic(this.surface, rect.ref());
                if (rect.width > 0 && rect.height > 0) {
                    if (rect.x < this.min_x) this.min_x = rect.x;
                    if (rect.y < this.min_y) this.min_y = rect.y;
                    if (this.max_x < rect.x + rect.width) this.max_x = rect.x + rect.width;
                    if (this.max_y < rect.y + rect.height) this.max_y = rect.y + rect.height;
                }
                this.last_event = tablet;
                let do_update = () => {
                    this.image.update_async(rect.x, rect.y, rect.width, rect.height);
                }
                if (this.move_count % 5 == 0) {
                    do_update();
                    this.move_count = 0;
                } else {
                    setImmediate(do_update)
                }
                this.move_count ++;
            
            }
        } else {
            if (this.painting) {
                // Release Event
                mypaint.mypaint_brush_reset(this.brush(tablet.tool_type).brush);
                let bounds = new mypaint.MyPaintRectangle();
                this.surface_extent.combine_with(gegl.gegl_buffer_get_extent(this.image.current_layer().buffer).deref());
                gegl.gegl_buffer_set_extent(this.image.current_layer().buffer, this.surface_extent.ref());
                bounds.x = this.min_x;
                bounds.y = this.min_y;
                bounds.width = this.max_x - this.min_x;
                bounds.height = this.max_y - this.min_y;
                this.undo.stop(bounds.x, bounds.y, bounds.width, bounds.height);
                this.image.undos.push(this.undo);
                this.undo = null;
                console.log("update "+bounds.x+","+bounds.y+","+bounds.width+","+bounds.height)
                this.image.update_async(bounds.x, bounds.y, bounds.width, bounds.height);
                ['.tool-box', '.vertical-tool-box',  '.horizontal-tool-box'].forEach((i)=>{
                    $(i).css({opacity: 1.0})
                });
                this.layer_list_view.update();
                console.log("suspend "+tablet.tool_type);
                this.brush(tablet.tool_type).suspend();
            }
            this.painting = false;
        }
    }
    swipe(event) {
        switch (event.event_type) {
            case 'begin':
                this.total_dx = 0;
                this.total_dy = 0;
                console.log("swipe: start: "+this.total_dx+","+this.total_dy);
                break;
            case 'update':
                this.total_dx += event.dx;
                this.total_dy += event.dy;
                break;
            case 'end':
                if (event.cancelled) {

                } else {
                    console.log("swipe: total: "+this.total_dx+","+this.total_dy);
                }
                break;
        };
    };

    on_change_current_layer(group, current_layer) {
        if (this.gegl_surface) {
            mypaint.mypaint_surface_unref(this.gegl_surface);
            mypaint.mypaint_surface_unref(this.surface);
        }
        this.gegl_surface = mypaint.mypaint_gegl_tiled_surface_new();
        mypaint.mypaint_gegl_tiled_surface_set_buffer(this.gegl_surface, current_layer.buffer);
        this.surface = mypaint.mypaint_gegl_tiled_surface_interface(this.gegl_surface);
    }
}

class BucketFillOperation {
    constructor(libinput, canvas = null, image = null, layer_list_view = null) {
        this.libinput = libinput;
        this.image = null;
        this.painting = false;
        if (canvas && image && layer_list_view)
            this.bind(canvas, image, layer_list_view);
    }

    bind(canvas, image, layer_list_view) {
        this.dispose();
        if (this.image) {
            try {
                image.off("layer-selected");
            } catch(e) {
                console.log(e);
            }
        }
        if (this.libinput) {
            try {
                this.libinput.off("tablet");
                this.libinput.off("swipe");
            } catch (e) {
                console.log(e);
            }
        }
        this.image = image;
        this.layer_list_view = layer_list_view;
        this.canvas = canvas;
        this.image.on('layer-selected', this.on_change_current_layer.bind(this));
        this.image.select_layer(this.image.current_layer()?-1: 0);
        this.libinput.on("tablet", this.tablet_motion.bind(this));
        this.libinput.on("swipe", this.swipe.bind(this));
    }
    unbind() {
        try {
            this.image.off('layer-selected');
        } catch(e) {
        }
        try {
            this.libinput.off("tablet");
            this.libinput.off("swipe");
        } catch(e) {}
        this.image = null;
        this.layer_list_view = null;
        this.canvas = null;
        this.dispose();
    }
    dispose() {
    }

    tablet_motion(tablet) {
        if (!this.image)
            return;
        let client = this.canvas.getBoundingClientRect();
        let offset_x = tablet.x - (client.left + window.screenLeft);
        let offset_y = tablet.y - (client.top + window.screenTop);
        if (tablet.pressure > 0) {
            if (tablet.tool_type == 1 && !this.painting) {
                gegl.with_buffer(gegl.gegl_buffer_new(null, gegl.babl_format("YA float")), (buffer)=> {
                gegl.with_node((top_node)=>{
                    let source  = gegl.node(top_node, {operation: 'gegl:buffer-source', buffer: this.image.current_layer().buffer });
                    let source2  = gegl.node(top_node, {operation: 'gegl:buffer-source', buffer: buffer });
                    console.log("define fill")
                    let fill    = gegl.node(top_node, {
                        operation: 'gegl:bucket-fill', 
                        transparent: true, 
                        antialias: true, 
                        threshold: 0, 
                        criterion: BigInt(0), 
                        x: offset_x, 
                        y: offset_y 
                    });
                    let conv = gegl.node(top_node, {
                        operation: 'gegl:write-buffer',
                        buffer: buffer
                    });
                    let color   = gegl.node(top_node, {
                        operation: 'gegl:rectangle', 
                        color: gegl.gegl_color_new("blue"),
                        x: 0, y:0, width: this.image.width, height: this.image.height
                    });
                    let alpha = gegl.node(top_node, {
                        operation: 'gegl:color-to-alpha',
                    });
                    source.connect_to(fill);
                    let mask  = gegl.node(top_node, {operation: 'gegl:multiply'});
                    let write = gegl.node(top_node, {operation: 'gegl:write-buffer', buffer: this.image.current_layer().buffer});
                    color.connect_to(mask, write);
                    let over = gegl.node(top_node, {
                        operation: 'gegl:over',
                    });
//                    source2.connect_to(alpha);
                    fill.output().connect_to(over.aux());
                    source2.connect_to(over)
                    over.output().connect_to(mask.aux());
                    write.process();
                });
                });
                this.painting = true;
                
                this.image.update_all_async();
            }
        } else {
            if (this.painting)
                this.painting = false;
        }
    }
    swipe(event) {
    };

    on_change_current_layer(group, current_layer) {
    }
}
class BrushPaletteView {
    constructor() {
        this.brushes = null;
        this.init();
    }

    bind(list, context) {
        this.list = list;
        this.context = context;
        for (let i = 1; i < 3; i ++) {
            this.context.set_brush(this.default_brush, i);
        }
        this.update();
    }

    unbind() {
        this.list = null;
        this.context = null;
    }

    update() {
        this.list.html("");
        for (let path in this.brushes) {
            let b = this.brushes[path];
            let img = $("<img>").addClass("rounded palette-button").attr("src", b.icon).appendTo(this.list);
            if (this.context.brush().brush == b.brush.brush) {
                img.addClass("border border-primary");
            }
            img.on("click", (ev) => {
                this.context.set_brush(b.brush);
                this.update();
            })
        }
        let fg = $("#color-fg");
        $("input", fg).attr("value", "hsv("+color_fg[0]+","+color_fg[1]+","+color_fg[2]+")");
        fg.colorpicker().on("colorpickerChange", (e)=>{
            color_fg = [e.color.hue / 360, e.color.saturation / 100, e.color.value / 100];
            console.log(color_fg);
        }).on("colorpickerShow", (ev) =>{
            console.log("colorpickerShow");
            libinput.grab_pointer();
        }).on("colorpickerHide", (ev) =>{
            console.log("hidePicker");
            libinput.ungrab_pointer();
        });

        let bg = $("#color-bg");
        $("input", bg).attr("value", "hsv("+color_bg[0]+","+color_bg[1]+","+color_bg[2]+")");
        bg.colorpicker().on("colorpickerChange", (e)=>{
            color_bg = [e.color.hue / 360, e.color.saturation / 100, e.color.value / 100];
            console.log(color_bg);
        }).on("colorpickerShow", (ev) =>{
            console.log("colorpickerShow");
            libinput.grab_pointer();
        }).on("colorpickerHide", (ev) =>{
            console.log("hidePicker");
            libinput.ungrab_pointer();
        });

        $('#radius-edit').attr({
            min: this.context.brush().setting_info("radius_logarithmic").min, 
            max: this.context.brush().setting_info("radius_logarithmic").max, 
            step: "any"
        }).on("input", (ev)=>{
            this.context.brush().base_value("radius_logarithmic", $('#radius-edit').val());
        }).val(this.context.brush().base_value("radius_logarithmic"));

        $('#opacity-edit').attr({
            min: this.context.brush().setting_info("opaque").min, 
            max: this.context.brush().setting_info("opaque").max, 
            step: "any"
        }).on("input", (ev)=>{
            this.context.brush().base_value("opaque", $('#opacity-edit').val());
        }).val(this.context.brush().base_value("opaque"));
    }

    init() {
        let brush_path = path.join(process.cwd(), "brushes");
        this.brushes = brush_loader(brush_path);
        for (let path in this.brushes) {
            this.brushes[path].brush = new MypaintBrush(this.brushes[path].brush);
            if (!this.default_brush) {
                this.default_brush = this.brushes[path].brush;
            }
        }
    }
}

class LayerListView {
    constructor(list = null, image = null) {
        if (list && image)
            this.bind(list, image);
    }

    bind(list, image) {
        this.unbind();
        this.list = list;
        this.image = image;
        this.dragged_layer_index = null;
        this.list.sortable({
            delay: 250,
            start: (ev, ui)=>{
                let layer = ui.item[0]["related-layer"];
                this.dragged_layer_index = layer.parent.layers.length - 1 - ui.item.index();
                libinput.grab_pointer();
            },
            stop: (ev, ui)=>{
                let layer = ui.item[0]["related-layer"];
                let dropped_layer_index = layer.parent.layers.length - 1 - ui.item.index();
                layer.parent.reorder_layer(layer, dropped_layer_index);
                this.image.undos.push(new layerundo.ReorderLayerUndo(layer, this.image, this.dragged_layer_index, dropped_layer_index));
                this.update();
                this.image.update_all_async();
                libinput.ungrab_pointer();
            },

        });
        this.update();
    }
    unbind() {
        if (this.list)
            this.list.sortable("destroy");
        this.list = null;
        this.image = null;
    }
    update() {
        this.list.html("");

        for (let i = this.image.layers.length - 1; i >= 0; i --) {
            // Extract Model
            let layer = this.image.layers[i];
            let thumb = layer.thumbnail(48);
    
            // View
            let item = $("<li>").css({width: 50, height: 50, position: "relative", "list-style": "none", margin: "0", padding: "0"}).addClass("rounded tool-item checkerboard-10 my-1").appendTo(this.list);
            item[0]["related-layer"] = layer;
            if (layer == this.image.current_layer())
                item.addClass("border-primary");
    
            let img  = $("<canvas>").css({width: thumb.width, height: thumb.height}).appendTo(item);
            img[0].width  = thumb.width;
            img[0].height = thumb.height;
    
            let ctx = img[0].getContext("2d");
            let imageData = new ImageData(thumb.buffer, thumb.width, thumb.height);
            ctx.putImageData(imageData, 0, 0);
    
            let delete_btn = $("<div>").addClass("text-white rounded-circle bg-danger layer-op-button").appendTo(item).css({ top: 0, right: 0 }).hide();
            $("<i>").addClass("fas fa-times fa-sm").appendTo(delete_btn).addClass("layer-op-icon").css({width: 14, height: 14, top: 0, left: 0 });
    
            let visible_btn = $("<div>").addClass("text-white rounded-circle bg-secondary layer-op-button").appendTo(item).css({top: 0, left: 0 }).hide();
            $("<i>").addClass(layer.visible? "fas fa-eye fa-sm": "fas fa-eye-slash fa-sm").appendTo(visible_btn).addClass("layer-op-icon").css({top: 0, left: 0, width: 14, height: 14 });
    
            // Controller
            item.on("click", (ev)=>{
                this.image.select_layer(i);        
                this.update();
            }).on("mouseenter", (ev)=>{
                delete_btn.show();
                visible_btn.show();
            }).on("mouseleave", (ev)=>{
                delete_btn.hide();
                visible_btn.hide();
            }).on("mousedown", (ev)=>{
                console.log("grab")
                libinput.grab_pointer();
            }).on("mouseleave", (ev)=>{
                console.log("ungrab")
                libinput.ungrab_pointer();
            })
    
            delete_btn.on("click", (ev)=>{
                console.log("remove layer "+layer)
                let updated = (this.image.current_layer() == layer);
                let index = this.image.layers.indexOf(layer);
                if (index >= 0) {
                    this.image.remove_layer(layer);
                    this.image.undos.push(new layerundo.RemoveLayerUndo(layer, this.image, index));
                    this.update();
                }
                this.image.update_all_async();
                return false
            });
            visible_btn.on("click",(ev)=>{
                console.log("visible")
                layer.set_visibility(!layer.visible);
                this.image.update_all_async();
                this.update();
                return false;
            });
        }
    }
}

function resize_canvas() {
    let canvas = $("#canvas")[0];
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (image)
        image.update_all_async();
}


$(window).on("load", () =>{
    resize_canvas();
    ipcRenderer.send("start");
})

$(window).on("resize", resize_canvas);

ipcRenderer.on("screen-size", (event, bounds) => {
    let canvas = $('#canvas')[0];
    let layer_list_dom = $('#layer-list');
    let brush_palette_dom = $("#brush-palette");

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
    
        image.select_layer(1);
        image.update_all_async();
    }
    
    LibInputWatcher(bounds);

    create_new_image(bounds);
    CavnasViewer(canvas, image);
    let layer_list_view    = new LayerListView();
    let brush_op           = new MyPaintBrushOperation(libinput);
    let bucket_fill_op     = new BucketFillOperation(libinput);
    let brush_palette_view = new BrushPaletteView();
    let current_op         = null;

    current_op = brush_op;

    layer_list_view.bind(layer_list_dom, image);
    current_op.bind(canvas, image, layer_list_view);
    brush_palette_view.bind(brush_palette_dom, current_op);

    $("#file-load").on("click", () =>{
        format_ora.load("test.ora").then((result)=>{
            image.dispose();
            image = result;
            CavnasViewer(canvas, image);
            current_op.bind(canvas, image, layer_list_view);
            layer_list_view.bind(layer_list_dom, image);
            brush_palette_view.bind(brush_palette_dom, current_op);
            image.update_all_async();
        });
    });
    $("#file-save").on("click", () =>{
        format_ora.save(image, "test.ora");
    });

    $("#undo").on("click", ()=>{
        console.log("undo");
        let drect = image.undos.undo();
        layer_list_view.update();
        if (drect)
            image.update_async(drect.x, drect.y, drect.width, drect.height);
        else
            image.update_all_async();
    });
    $("#redo").on("click", ()=>{
        console.log("redo");
        let drect = image.undos.redo();
        layer_list_view.update();
        if (drect)
            image.update_async(drect.x, drect.y, drect.width, drect.height);
        else
            image.update_all_async();
    });

    ['.tool-box', '.vertical-tool-box', '.horizontal-tool-box'].forEach((i) => {
        $(i).on("mouseenter", (ev)=>{
            if (!current_op.painting) {
                console.log("suspend");
                libinput.suspend();
            }
            ev.stopPropagation();
        });
        $(i).on("mouseleave", (ev)=>{
            if (!current_op.painting) {
                console.log("resume");
                libinput.resume();
            }
        });
    });

    $(document.body).on("mouseenter",(ev) => {
        if (!current_op.painting) {
            console.log("resume");
            libinput.resume();
        }
    });
    $(document.body).on("mouseleave", (ev)=>{
        if (!current_op.painting) {
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
        layer_list_view.update();
    });

    $('#new-file').on("click", ()=>{
        // ToDo: required confirmation if image is modified.
        create_new_image(bounds);
        CavnasViewer(canvas, image);
        layer_list_view.bind(layer_list_dom, image);
        brush_palette_view.bind(brush_palette_dom, current_op);
        current_op.bind(canvas, image, layer_list_view);
    });

    $('#paint').on("click", ()=>{
        $('#eraser').removeClass("text-primary").addClass("text-secondary");
        $('#paint').removeClass("text-secondary").addClass("text-primary");
        $('#bucket-fill').removeClass("text-primary").addClass("text-secondary");
        current_op.unbind();
        current_op = brush_op;
        current_op.bind(canvas, image, layer_list_view);
        current_op.default_mode = 1;
        brush_palette_view.update();
    });

    $('#eraser').on("click", ()=>{
        $('#paint').removeClass("text-primary").addClass("text-secondary");
        $('#eraser').removeClass("text-secondary").addClass("text-primary");
        $('#bucket-fill').removeClass("text-primary").addClass("text-secondary");
        current_op.unbind();
        current_op = brush_op;
        current_op.bind(canvas, image, layer_list_view);
        current_op.default_mode = 2;
        brush_palette_view.update();
    });
    $('#bucket-fill').on("click", ()=>{
        $('#paint').removeClass("text-primary").addClass("text-secondary");
        $('#eraser').removeClass("text-primary").addClass("text-secondary");
        $('#bucket-fill').removeClass("text-secondary").addClass("text-primary");
        current_op.unbind();
        current_op = bucket_fill_op;
        current_op.bind(canvas, image, layer_list_view);
        current_op.default_mode = 2;
    });
    $('#paint').removeClass("text-secondary").addClass("text-primary");
    $('#eraser').removeClass("text-primary").addClass("text-secondary");
    $('#bucket-fill').removeClass("text-primary").addClass("text-secondary");
})
