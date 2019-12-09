import gegl from '../ffi/gegl';
import LayerBufferUndo from '../rasterlib/layerbufferundo';
const cconv = require('color-convert');

export default class BucketFillOperation {
    constructor(libinput, canvas = null, editor = null, layer_list_view = null) {
        this.libinput = libinput;
        this.editor = null;
        this.painting = false;
        if (canvas && editor && layer_list_view)
            this.bind(canvas, image, layer_list_view);
    }

    bind(canvas, editor, layer_list_view) {
        this.dispose();
        this.unbind();
        console.log("BucketFill::bind");
        this.editor = editor;
        this.layer_list_view = layer_list_view;
        this.canvas = canvas;
        this.editor.image.on('layer-selected', this.on_change_current_layer.bind(this));
        this.editor.image.select_layer(this.editor.image.current_layer()?-1: 0);
        this.libinput.on("tablet", this.tablet_motion.bind(this));
        this.libinput.on("swipe", this.swipe.bind(this));
    }
    unbind() {
        console.log("BucketFill::unbind");
        try {
            if (this.editor && this.editor.image)
                this.editor.image.removeAllListeners('layer-selected');
        } catch(e) {
        }
        try {
            this.libinput.removeAllListeners("tablet");
            this.libinput.removeAllListeners("swipe");
        } catch(e) {}
        this.editor = null;
        this.layer_list_view = null;
        this.canvas = null;
        this.dispose();
    }
    dispose() {
    }

    tablet_motion(tablet) {
        if (!this.editor || !this.editor.image)
            return;
        let client = this.canvas.getBoundingClientRect();
        let offset_x = tablet.x - (client.left + window.screenLeft);
        let offset_y = tablet.y - (client.top + window.screenTop);
        if (tablet.pressure > 0) {
            if (tablet.tool_type == 1 && !this.painting) {
                let bounds = gegl.gegl_buffer_get_extent(this.editor.image.current_layer().buffer).deref();
                let bounds2 = gegl.gegl_buffer_get_extent(this.editor.image.buffer).deref();
                let undo = new LayerBufferUndo(this.editor.image, this.editor.image.current_layer());
                undo.start();

                gegl.gegl_buffer_set_extent(this.editor.image.current_layer().buffer, bounds2.ref());
                let rgb = cconv.hsv.rgb([this.editor.color_fg[0] * 360, this.editor.color_fg[1] * 100, this.editor.color_fg[2] * 100]);
                let rgb_text = "rgb("+(rgb[0] / 255)+","+(rgb[1] / 255)+","+(rgb[2] / 255)+")";
                gegl.process([
                    { operation: 'gegl:write-buffer', buffer: this.editor.image.current_layer().buffer },
                    { operation: 'gegl:over',
                      aux: [{ operation: 'gegl:opacity', 
                              aux:   [{ operation: 'gegl:bucket-fill', 
                                        transparent: true, antialias: true, 
                                        threshold: 0.1, criterion: BigInt(0), 
                                        x: offset_x, y: offset_y,}, 
                                      { operation: 'gegl:buffer-source', buffer: this.editor.image.buffer }],
                              input: [{ operation: 'gegl:rectangle', 
                                        color: gegl.gegl_color_new(rgb_text),
                                        x: 0, y:0, width: this.editor.image.width, height: this.editor.image.height }]
                            }],
                      input: [{ operation: 'gegl:buffer-source', buffer: this.editor.image.current_layer().buffer }] }
                ]);
                this.painting = true;
                undo.stop(bounds.x, bounds.y, bounds.width, bounds.height);
                this.editor.image.undos.push(undo);

                this.editor.image.update_all_async();
            }
        } else {
            if (this.painting)
                this.painting = false;
        }
    }
    swipe(event) {
    };

    on_change_current_layer(group, current_layer) {
    }
}