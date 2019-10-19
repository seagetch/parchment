var gegl;

class LayerBufferUndo {
    constructor(image, layer) {
        this.image = image;
        this.layer = layer;
        this.bounds = null;
    }
    start() {
        this.undo_buffer = this.layer.clone_buffer();
    }
    stop() {
    }
    stop(x, y, w, h) {
        this.bounds = new gegl.GeglRectangle();
        this.bounds.x = x;
        this.bounds.y = y;
        this.bounds.width = w;
        this.bounds.height = h;
    }
    undo() {
        if (this.undo_buffer) {
            console.log("LayerBufferUndo:undo")
            this.redo_buffer = this.layer.clone_buffer();
            this.layer.copy_from_buffer(this.undo_buffer);
            if (this.bounds)
                this.image.update(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.y);
            else
                this.image.update_all();
        }
    }
    redo() {
        if (this.redo_buffer) {
            this.undo_buffer = this.layer.clone_buffer();
            this.layer.copy_from_buffer(this.redo_buffer);
            if (this.bounds)
                this.image.update(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.y);
            else
                this.image.update_all();
        }
    }
    dispose() {
        if (this.redo_buffer)
            gegl.g_object_unref(this.redo_buffer);
        if (this.undo_buffer)
            gegl.g_object_unref(this.undo_buffer);
    }
}
function init(_gegl) {
    gegl = _gegl;
    return LayerBufferUndo;
}
module.exports = init;