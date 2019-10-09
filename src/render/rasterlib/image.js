const gegl = require("../ffi/gegl");
const Layer = require('./layer')

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
        this.buffer = gegl.gegl_buffer_new(rect.ref(), gegl.babl_format("R'aG'aB'aA u15"));
    }
    add_layer(layer) {
        this.layers.push(layer)
        layer.parent = this;
    }
    remove_layer(layer) {
        var i = this.layers.indexOf(layer);
        if (i >= 0) {
            this.layers.splice(i, 1);
            layer.parent = null;
        }
    }
    update(x, y, width, height) {
        let gnode = gegl.node();
        let node = null;
        for (let i = 0; i < this.layers.length; i ++) {
            node = this.layers[i].update_op(gnode, node);
        }
        let last_node = gegl.node(gnode, {operation: "gegl:write-buffer", buffer: this.buffer});
        node.connect_to(last_node)
        let rect = new gegl.GeglRectangle();
        rect.x = x
        rect.y = y
        rect.width = width;
        rect.height = height;
        let processor = last_node.new_processor(x, y, width, height);
        while (gegl.gegl_processor_work(processor, null)) {};

        gnode.dispose();
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

module.exports = RasterImage;