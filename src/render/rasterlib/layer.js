const gegl = require("../ffi/gegl");
const ref  = require("ref-napi");
class RasterLayer {
    constructor(x, y, width, height) {
        var rect = new gegl.GeglRectangle();
        this.parent = null;
        this.x      = x;
        this.y      = y;
        this.width  = width;
        this.height = height;
        rect.x      = x;
        rect.y      = y;
        rect.width  = width;
        rect.height = height;
        this.buffer = gegl.gegl_buffer_new(rect.ref(), gegl.babl_format("R'aG'aB'aA u15"));
    }
    dispose() {
        gegl.g_object_unref(this.buffer);
        this.buffer = null;
    }
    resize(width, height) {

    }

    lock(format, rect, callback) {
        let stride = ref.alloc("int")
        let buf  = gegl.gegl_buffer_linear_open(this.buffer, rect? rect.ref(): null, stride, format);
        callback(buf, stride.deref());
        gegl.gegl_buffer_linear_close(this.buffer, buf);
    }

    move(x, y) {
        this.x = x;
        this.y = y;
    }
    update_op(top_node, base_node) {
        if (!base_node) {
            return gegl.node(top_node, {operation: "gegl:buffer-source", buffer: this.buffer});
        } else {
            let new_node = gegl.node(top_node, { operation: "gegl:over" });
            base_node.connect_to(new_node);
            let aux_node = gegl.node(top_node, {operation: "gegl:buffer-source", buffer: this.buffer});
            aux_node.output().connect_to(new_node.aux());
            return new_node;
        }
    }
};
module.exports = RasterLayer;