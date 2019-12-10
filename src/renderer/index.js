const { ipcRenderer } = require('electron')
const ref = require('ref-napi');
const path = require('path');
const process = require("process");
const cconv = require('color-convert');

import gegl from './ffi/gegl';
import RasterImage from './rasterlib/image';
import RasterLayer from './rasterlib/layer';
import LayerGroup from './rasterlib/layergroup';
import libinput from './ffi/libinput';
import mypaint, {MypaintBrush} from './ffi/libmypaint';
import * as layerundo from './rasterlib/layerundo';
import * as format_ora from './rasterlib/format/ora';
import MyPaintBrushOperation from "./paint-tools/paintbrush";
import BucketFillOperation from "./paint-tools/bucketfill";
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

class Viewport {
    constructor() {
        this.h_flipped = false;
        this.canvas = null;
        this.center = 0;
        this.scale = 1;
    }
    bind(canvas) {
        this.canvas = canvas;
    }
    unbind() {
        this.canvas = null;
    }

    to_view_coord(x, y) {
        return [x, y];
    }

    to_image_coord(x, y) {
        if (!this.canvas)
            return x, y;
        let client = this.canvas.getBoundingClientRect();
        let offset_x = x - (client.left + window.screenLeft);
        if (this.h_flipped) {
            offset_x = this.canvas.width - offset_x;
        }
        let offset_y = y - (client.top + window.screenTop);
        return [offset_x, offset_y];                
    }
}
class Editor {
    constructor() {
        this.color_fg = [  0,   0,   0];
        this.color_bg = [  0,   0,   1];
        
        this.image = null;        
        this.viewport = new Viewport();
    }

    new_image(bounds) {
        if (this.image)
            this.image.dispose();
        this.image = new RasterImage(bounds.width, bounds.height);
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
        this.image.add_layer(base_layer);
        let layer = new RasterLayer(0, 0, -1, -1);
        this.image.add_layer(layer);
    
        this.image.select_layer(1);
        this.image.update_all_async();
    }

    add_layer() {
        let current_layer = this.image.current_layer();
        let group = current_layer.parent;
        let index = group.layers.indexOf(current_layer) + 1;
        let layer = new RasterLayer(0, 0, -1, -1);
        group.insert_layer(layer, index);
        this.image.undos.push(new layerundo.InsertLayerUndo(layer, group, index));
    }

    undo() {
        console.log("undo");
        let drect = this.image.undos.undo();
        if (drect)
            this.image.update_async(drect.x, drect.y, drect.width, drect.height);
        else
            this.image.update_all_async();
    }

    redo() {
        console.log("redo");
        let drect = this.image.undos.redo();
        if (drect)
            this.image.update_async(drect.x, drect.y, drect.width, drect.height);
        else
            this.image.update_all_async();
    }
};

let editor = new Editor();

function CavnasViewer(canvas, image) {
    let on_image_update = (image, x, y, w, h) => {
        let ctx = canvas.getContext("2d");
        let rect2 = new gegl.GeglRectangle();
        rect2.x = x;
        rect2.y = y;
        rect2.width = w;
        rect2.height = h;
        image.lock(gegl.babl_format("R'aG'aB'aA u8"), rect2, (buffer, stride) => {
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
class BrushPaletteView {
    constructor() {
        this.brushes = null;
        this.init();
    }

    bind(list, editor, context) {
        this.list = list;
        this.editor = editor;
        this.context = context;
        for (let i = 1; i < 3; i ++) {
            // Should be consider the case where context is not a brush.
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
        let cfg = cconv.hsv.rgb(this.editor.color_fg[0] * 360, this.editor.color_fg[1] * 100, this.editor.color_fg[2] * 100);
        $("input", fg).attr("value", "rgb("+cfg[0]+","+cfg[1]+","+cfg[2]+")");
        fg.colorpicker().on("colorpickerChange", (e)=>{
            this.editor.color_fg = [e.color.hue / 360, e.color.saturation / 100, e.color.value / 100];
        }).on("colorpickerShow", (ev) =>{
            console.log("colorpickerShow");
            libinput.grab_pointer();
        }).on("colorpickerHide", (ev) =>{
            console.log("hidePicker");
            libinput.ungrab_pointer();
        });

        let bg = $("#color-bg");
        let cbg = cconv.hsv.rgb(this.editor.color_bg[0] * 360, this.editor.color_bg[1] * 100, this.editor.color_bg[2] * 100);
        $("input", bg).attr("value", "rgb("+cbg[0]+","+cbg[1]+","+cbg[2]+")");
        bg.colorpicker().on("colorpickerChange", (e)=>{
            this.editor.color_bg = [e.color.hue / 360, e.color.saturation / 100, e.color.value / 100];
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
            this.context.brush().resume();
            this.context.brush().base_value("radius_logarithmic", $('#radius-edit').val());
            this.context.brush().suspend();
        }).val(this.context.brush().base_value("radius_logarithmic"));

        $('#opacity-edit').attr({
            min: this.context.brush().setting_info("opaque").min, 
            max: this.context.brush().setting_info("opaque").max, 
            step: "any"
        }).on("input", (ev)=>{
            this.context.brush().resume();
            this.context.brush().base_value("opaque", $('#opacity-edit').val());
            this.context.brush().suspend();
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
    constructor(list = null, editor = null) {
        if (list && editor)
            this.bind(list, editor);
    }

    bind(list, editor) {
        this.unbind();
        this.list = list;
        this.editor = editor;
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
                this.editor.image.undos.push(new layerundo.ReorderLayerUndo(layer, this.editor.image, this.dragged_layer_index, dropped_layer_index));
                this.update();
                this.editor.image.update_all_async();
                libinput.ungrab_pointer();
            },

        });
        this.update();
    }
    unbind() {
        if (this.list)
            this.list.sortable("destroy");
        this.list = null;
        this.editor = null;
    }
    update() {
        this.list.html("");

        for (let i = this.editor.image.layers.length - 1; i >= 0; i --) {
            // Extract Model
            let layer = this.editor.image.layers[i];
            let thumb = layer.thumbnail(48);
    
            // View
            let item = $("<li>").css({width: 50, height: 50, position: "relative", "list-style": "none", margin: "0", padding: "0"}).addClass("rounded tool-item checkerboard-10 my-1").appendTo(this.list);
            item[0]["related-layer"] = layer;
            if (layer == this.editor.image.current_layer())
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
                this.editor.image.select_layer(i);        
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
                let updated = (this.editor.image.current_layer() == layer);
                let index = this.editor.image.layers.indexOf(layer);
                if (index >= 0) {
                    this.editor.image.remove_layer(layer);
                    this.editor.image.undos.push(new layerundo.RemoveLayerUndo(layer, this.editor.image, index));
                    this.update();
                }
                this.editor.image.update_all_async();
                return false
            });
            visible_btn.on("click",(ev)=>{
                console.log("visible")
                layer.set_visibility(!layer.visible);
                this.editor.image.update_all_async();
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
    if (editor.image)
        editor.image.update_all_async();
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
    
    LibInputWatcher(bounds);

    editor.viewport.bind(canvas);
    editor.new_image(bounds);
    CavnasViewer(canvas, editor.image);
    let layer_list_view    = new LayerListView();
    let brush_op           = new MyPaintBrushOperation(libinput);
    let bucket_fill_op     = new BucketFillOperation(libinput);
    let brush_palette_view = new BrushPaletteView();
    let current_op         = null;

    current_op = brush_op;

    layer_list_view.bind(layer_list_dom, editor);
    current_op.bind(canvas, editor, layer_list_view);
    brush_palette_view.bind(brush_palette_dom, editor, current_op);

    $("#file-load").on("click", () =>{
        format_ora.load("test.ora").then((result)=>{
            editor.image.dispose();
            editor.image = result;
            CavnasViewer(canvas, editor.image);
            current_op.bind(canvas, editor, layer_list_view);
            layer_list_view.bind(layer_list_dom, editor);
            brush_palette_view.bind(brush_palette_dom, editor, current_op);
            editor.image.update_all_async();
        });
    });
    $("#file-save").on("click", () =>{
        format_ora.save(editor.image, "test.ora");
    });

    $("#undo").on("click", ()=>{
        editor.undo();
        layer_list_view.update();
    });
    $("#redo").on("click", ()=>{
        editor.redo();
        layer_list_view.update();
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
        editor.add_layer();
        layer_list_view.update();
    });

    $('#new-file').on("click", ()=>{
        // ToDo: required confirmation if image is modified.
        editor.new_image(bounds);
        CavnasViewer(canvas, editor.image);
        layer_list_view.bind(layer_list_dom, editor);
        brush_palette_view.bind(brush_palette_dom, editor, current_op);
        current_op.bind(canvas, editor, layer_list_view);
    });

    $('#paint').on("click", ()=>{
        $('#eraser').removeClass("text-primary").addClass("text-secondary");
        $('#paint').removeClass("text-secondary").addClass("text-primary");
        $('#bucket-fill').removeClass("text-primary").addClass("text-secondary");
        current_op.unbind();
        current_op = brush_op;
        current_op.bind(canvas, editor, layer_list_view);
        current_op.default_mode = 1;
        brush_palette_view.update();
    });

    $('#eraser').on("click", ()=>{
        $('#paint').removeClass("text-primary").addClass("text-secondary");
        $('#eraser').removeClass("text-secondary").addClass("text-primary");
        $('#bucket-fill').removeClass("text-primary").addClass("text-secondary");
        current_op.unbind();
        current_op = brush_op;
        current_op.bind(canvas, editor, layer_list_view);
        current_op.default_mode = 2;
        brush_palette_view.update();
    });
    $('#bucket-fill').on("click", ()=>{
        $('#paint').removeClass("text-primary").addClass("text-secondary");
        $('#eraser').removeClass("text-primary").addClass("text-secondary");
        $('#bucket-fill').removeClass("text-secondary").addClass("text-primary");
        current_op.unbind();
        current_op = bucket_fill_op;
        current_op.bind(canvas, editor, layer_list_view);
    });
    $('#paint').removeClass("text-secondary").addClass("text-primary");
    $('#eraser').removeClass("text-primary").addClass("text-secondary");
    $('#bucket-fill').removeClass("text-primary").addClass("text-secondary");
    $('#h-flip').on("click", ()=>{
        editor.viewport.h_flipped = !editor.viewport.h_flipped;
        $(canvas).css("transform", "scale("+(editor.viewport.h_flipped? -1: 1)+", 1)");
        if (editor.viewport.h_flipped)
            $('#h-flip').removeClass("text-primary").addClass("bg-primary text-white");
        else
            $('#h-flip').removeClass("bg-primary text-white").addClass("text-primary");
    });
})
