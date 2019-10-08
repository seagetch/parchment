class Image {
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

    }
    update() {
        return this.update(x, y, this.width, this.height);
    }
};