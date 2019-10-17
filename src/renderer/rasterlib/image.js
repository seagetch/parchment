const Layer_Generator = require('./layer');
const ref = require('ref-napi');

var gegl;
var Layer;

class RasterImage {
    constructor(width, height) {
        this.layers = [];
        var rect = new gegl.GeglRectangle();
        this.parent = null;
        rect.x      = 0;
        rect.y      = 0;
        rect.width  = width;
        rect.height = height;
        this.width  = width;
        this.height = height;
        this.buffer = gegl.gegl_buffer_new(rect.ref(), gegl.babl_format("R'G'B'A u8"));
    }
    dispose() {
        for (let i = 0; i < this.layers.length; i ++)
            this.layers[i].dispose();
        this.layers.length = 0;
        gegl.g_object_unref(this.buffer);
        if (this.gnode)
            this.gnode.dispose();
        if (this.last_node)
            this.last_node.dispose();
        this.gnode = null;
        this.last_node = null;
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
    remove_layer(layer) {
        var i = this.layers.indexOf(layer);
        if (i >= 0) {
            this.layers.splice(i, 1);
            layer.parent = null;
        }
        this.validate();
    }
    update_op() {
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
            this.update_op();
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
    lock(format, rect, callback) {
        let stride = ref.alloc("int")
        let buf  = gegl.gegl_buffer_linear_open(this.buffer, rect? rect.ref(): null, stride, format);
        callback(buf, stride.deref());
        gegl.gegl_buffer_linear_close(this.buffer, buf);
    }
    select_layer(index) {
        if (index < this.layers.length) {
            this.current_layer = this.layers[index];
        }
        return this.current_layer;
    }
};

function init(_gegl) {
    gegl = _gegl;
    Layer = Layer_Generator(gegl);
    return RasterImage;
}
module.exports = init;