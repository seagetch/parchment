const gegl = require("../ffi/gegl");
class Layer {
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
    move(x, y) {
        this.x = x;
        this.y = y;
    }
    update_op(base_layer, x, y, width, height) {
        if (!base_layer) {

        } else {
            
        }
    }
};
module.exports = Layer;