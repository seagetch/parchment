import gegl from '../ffi/gegl';

export default class LayerBufferUndo {
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
            let rect = gegl.gegl_buffer_get_extent(this.undo_buffer).deref();
            console.log("undo: rect="+rect.x+","+rect.y+","+rect.width+","+rect.height)
            this.redo_buffer = this.layer.clone_buffer();
            this.layer.copy_from_buffer(this.undo_buffer);
            return this.bounds;
        } else {
            console.log("No undo buffer");
        }
        return null;
    }
    redo() {
        if (this.redo_buffer) {
            this.undo_buffer = this.layer.clone_buffer();
            this.layer.copy_from_buffer(this.redo_buffer);
            return this.bounds;
        }
        return null;
    }
    dispose() {
        if (this.redo_buffer)
            gegl.g_object_unref(this.redo_buffer);
        if (this.undo_buffer)
            gegl.g_object_unref(this.undo_buffer);
    }
};