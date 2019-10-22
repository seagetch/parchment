const ref = require('ref-napi');

import gegl from '../ffi/gegl';
import RasterLayer from './layer';

export default class LayerGroup extends RasterLayer {
    constructor(x, y, width, height) {
        super(x, y, width, height, gegl.babl_format("R'G'B'A u8"))
        this.layers = [];
        var rect = new gegl.GeglRectangle();
        this.parent = null;
        this.compositor = "gegl:over";
        this.visible = true;        
    }
    dispose() {
        for (let i = 0; i < this.layers.length; i ++)
            this.layers[i].dispose();
        this.layers.length = 0;
        if (this.gnode)
            this.gnode.dispose();
        if (this.last_node)
            this.last_node.dispose();
        this.gnode = null;
        this.last_node = null;
        super.dispose();
    }
    validate() {
        if (this.last_node) {
            this.last_node.dispose();
            this.last_node = null;
        }
    }
    add_layer(layer) {
        this.layers.push(layer)
        layer.parent = this;
        this.validate();
    }
    insert_layer(layer, index) {
        if (index == this.layers.length)
            this.add_layer(layer);
        else {
            this.layers.splice(index, 0, layer);
            layer.parent = this;
            this.validate();
        }
    }
    remove_layer(layer) {
        var i = this.layers.indexOf(layer);
        if (i >= 0) {
            console.log("remove_layer: remove layer at "+i)
            this.layers.splice(i, 1);
            layer.parent = null;
        } else {
            console.log("remove_layer: tried to remove unknown layer")
        }
        if (layer == this.current_layer) {
            this.current_layer = (i < this.layers.length)? this.layers[i]: this.layers[this.layers.length - 1];
        }
        this.validate();
    }
    update_children_op() {
        if (this.gnode)
            this.gnode.dispose();

        this.gnode = gegl.node();
        let node = null;
        for (let i = 0; i < this.layers.length; i ++) {
            node = this.layers[i].update_op(this.gnode, node);
        }
        this.last_node = gegl.node(this.gnode, {operation: "gegl:write-buffer", buffer: this.buffer});
        node.connect_to(this.last_node);
    }
    update_processor(x, y, width, height) {
        if (!this.last_node)
            this.update_children_op();
        let rect = new gegl.GeglRectangle();
        rect.x = x
        rect.y = y
        rect.width = width;
        rect.height = height;
        return this.last_node.new_processor(x, y, width, height);
    }
    update(x, y, width, height) {
        let processor = this.update_processor(x, y, width, height)
        while (gegl.gegl_processor_work(processor, null)) {};
        gegl.g_object_unref(processor);
    }
    update_async(x, y, width, height, callback) {
        if (this.awaiting_rect) {
            if (x < this.awaiting_rect[0]) {
                this.awaiting_rect[0] = x;
            }
            if (y < this.awaiting_rect[1]) {
                this.awaiting_rect[1] = y;
            }
            if (x + width > this.awaiting_rect[2]) {
                this.awaiting_rect[2] = x + width;
            }
            if (y + height > this.awaiting_rect[3]) {
                this.awaiting_rect[3] = y + height;
            }
        }
        if (this.updating){
            if (!this.awaiting_rect) {
                this.awaiting_rect = [x, y, x + width, y + height];
            }
            return;
        }
        let r_x = this.awaiting_rect? this.awaiting_rect[0]: x;
        let r_y = this.awaiting_rect? this.awaiting_rect[1]: y;
        let r_w = this.awaiting_rect? this.awaiting_rect[2] - this.awaiting_rect[0]: width;
        let r_h = this.awaiting_rect? this.awaiting_rect[3] - this.awaiting_rect[1]: height;
        let processor = this.update_processor(r_x, r_y, r_w, r_h);
        this.awaiting_rect = null;
        this.updating = true;
        let waiter = (err, result) => {
            if (result)
                gegl.gegl_processor_work.async(processor, null, waiter);
            else {
                callback(r_x, r_y, r_w, r_h);
                this.updating = false;
                if (this.awaiting_rect) {
                    let r_x = this.awaiting_rect[0];
                    let r_y = this.awaiting_rect[1];
                    let r_w = this.awaiting_rect[2] - this.awaiting_rect[0];
                    let r_h = this.awaiting_rect[3] - this.awaiting_rect[1];
                    let self = this;
                    this.awaiting_rect = null;
                    setImmediate(() => {self.update_async(r_x, r_y, r_w, r_h, callback)});
                }
                gegl.g_object_unref(processor);
            }
        }
        waiter(null, true);
    }
    update_all() {
        this.update(0, 0, this.width, this.height);
    }
    select_layer(index) {
        if (index < this.layers.length) {
            this.current_layer = this.layers[index];
        }
        return this.current_layer;
    }
};
/*
export default function init(_gegl) {
    gegl = _gegl;
    return LayerGroup;
}
*/