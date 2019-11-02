const ref  = require("ref-napi");

import gegl from '../ffi/gegl';
var color_format = gegl.babl_format("R'aG'aB'aA u15");
export default class RasterLayer {
    constructor(x, y, width = -1, height = -1, format = color_format) {
        var rect = null;
        this.parent = null;
        if (width > 0 && height > 0) {
            rect = new gegl.GeglRectangle();
            this.x      = x;
            this.y      = y;
            this.width  = width;
            this.height = height;
            rect.x      = x;
            rect.y      = y;
            rect.width  = width;
            rect.height = height;
        }
        this.format = format;
        this.buffer = gegl.gegl_buffer_new(rect? rect.ref(): null, format);
        this.compositor = "gegl:over";
        this.visible = true;
    }
    dispose() {
        gegl.g_object_unref(this.buffer);
        this.buffer = null;
    }
    resize(width, height) {

    }
    set_compositor(comp) {
        this.compositor = comp;
        if (this.parent)
            this.parent.validate();
    }

    lock(format, rect, callback) {
        let stride = ref.alloc("int")
        let buf  = gegl.gegl_buffer_linear_open(this.buffer, rect? rect.ref(): null, stride, format? format:color_format);
        callback(buf, stride.deref());
        gegl.gegl_buffer_linear_close(this.buffer, buf);
    }

    move(x, y) {
        this.x = x;
        this.y = y;
    }
    update_op(top_node, base_node) {
        if (!this.visible)
            return base_node;
        if (!base_node) {
            return gegl.node(top_node, {operation: "gegl:buffer-source", buffer: this.buffer});
        } else {
            let new_node = gegl.node(top_node, { operation: this.compositor });
            base_node.connect_to(new_node);
            let aux_node = gegl.node(top_node, {operation: "gegl:buffer-source", buffer: this.buffer});
            aux_node.output().connect_to(new_node.aux());
            return new_node;
        }
    }
    clone_buffer() {
        return gegl.with_node((top_node) => {
            var rect = new gegl.GeglRectangle();
            rect.x = this.x;
            rect.y = this.y;
            rect.width = this.width;
            rect.height = this.height;
            let buffer = gegl.gegl_buffer_new(rect.ref(), this.format);
            let in_node = gegl.node(top_node, {operation: "gegl:buffer-source", buffer: this.buffer});
            let out_node = gegl.node(top_node, {operation: "gegl:copy-buffer", buffer: buffer});
            in_node.output().connect_to(out_node.input());
            out_node.process();
            return buffer;
        });
    }
    copy_from_buffer(buffer) {
        gegl.with_node((top_node) => {
            let in_node  = gegl.node(top_node, {operation: "gegl:buffer-source", buffer: buffer});
            let out_node = gegl.node(top_node, {operation: "gegl:copy-buffer",   buffer: this.buffer});
            in_node.output().connect_to(out_node.input());
            out_node.process();
        });
    }
    thumbnail(size) {
        let thumb_x, thumb_y;
        if (this.width > 0 && this.height > 0){
            if (this.width > this.height) {
                thumb_x = size;
                thumb_y = size * this.height / this.width;
            } else {
                thumb_y = size;
                thumb_x = size * this.width / this.height;
            }    
        } else {
            let ext = gegl.gegl_buffer_get_extent(this.buffer).deref();
            if (ext.width > ext.height) {
                thumb_x = size;
                thumb_y = size * ext.height / ext.width;
            } else if (ext.width < ext.height) {
                thumb_y = size;
                thumb_x = size * ext.width / ext.height;
            } else {
                thumb_x = size;
                thumb_y = size;
            }
        }
        var rect = new gegl.GeglRectangle();
        rect.x = 0;
        rect.y = 0;
        rect.width = thumb_x;
        rect.height = thumb_y;
        console.log("thumb_x:"+rect.width+",thumb_y:"+rect.height)

        return gegl.with_node((top_node)=>{
            console.log("thumbnail")
            let in_node = gegl.node(top_node, {operation: "gegl:buffer-source", buffer: this.buffer});
            let scale_node = gegl.node(top_node, {operation: "gegl:scale-size", sampler: gegl.GEGL_SAMPLER_NEAREST, x: thumb_x, y: thumb_y});
            in_node.output().connect_to(scale_node.input());
            let buffer = new Uint8ClampedArray(rect.width * rect.height * 4);
            scale_node.blit(rect, buffer);
            return {width: rect.width, height: rect.height, buffer: buffer};
        });
    }
    set_visibility(value) {
        if (value != this.visible) {
            this.visible = value;
            if (this.parent){
                this.parent.validate();
            }
        }
    }
};