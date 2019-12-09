import gegl from '../ffi/gegl';
import LayerBufferUndo from '../rasterlib/layerbufferundo';
import mypaint, {MyPaintBrushModifier} from '../ffi/libmypaint';

export default class MyPaintBrushOperation {
    constructor(libinput, canvas = null, editor = null, layer_list_view = null) {
        this.libinput = libinput;
        this.brushes = [null];
        this.brushes.push(new MyPaintBrushModifier());
        this.brushes.push(new MyPaintBrushModifier({"eraser": 1}));
        this.painting = false;
        this.last_event = {x: 0, y: 0, time: 0}
        this.min_x = null; 
        this.min_y = null;
        this.max_x = null;
        this.max_y = null;
        this.undo = null;
        this.move_count = 0;
        this.gegl_surface = null;
        this.surface_extent = null;
        this.surface = null;
        this.total_dx = null;
        this.total_dy = null;
        this.default_mode = 1;
        if (canvas && editor && layer_list_view)
            this.bind(canvas, editor, layer_list_view);
    }

    brush(index = 1) {
        if (index == 1) {
            return this.brushes[this.default_mode];
        } else {
            return this.brushes[index];
        }
    }

    set_brush(_brush, tablet_button = 1) {
        if (tablet_button == 1) {
            this.brushes[this.default_mode].bind(_brush);
            this.brushes[this.default_mode].suspend();
        } else {
            this.brushes[tablet_button].bind(_brush);
            this.brushes[tablet_button].suspend();
        }
    }

    bind(canvas, editor, layer_list_view) {
        this.unbind();
        console.log("PaintBrush::bind");
        this.editor = editor;
        this.layer_list_view = layer_list_view;
        this.canvas = canvas;
        this.editor.image.on('layer-selected', this.on_change_current_layer.bind(this));
        this.editor.image.select_layer(this.editor.image.current_layer()?-1: 0);
        this.libinput.on("tablet", this.tablet_motion.bind(this));
        this.libinput.on("swipe", this.swipe.bind(this));
    }
    unbind() {
        console.log("PaintBrush::unbind");
        try {
            this.editor.image.removeAllListeners('layer-selected');
        } catch(e){}
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
        if (this.gegl_surface) {
            mypaint.mypaint_surface_unref(this.gegl_surface);
            mypaint.mypaint_surface_unref(this.surface);
            this.gegl_surface = null;
            this.surface = null;
        }
    }

    tablet_motion(tablet) {
        if (!this.editor.image || !this.surface || !this.brush)
            return;
        let client = this.canvas.getBoundingClientRect();
        let offset_x = tablet.x - (client.left + window.screenLeft);
        let offset_y = tablet.y - (client.top + window.screenTop);
        if (tablet.pressure > 0) {
            if (!this.painting) {
                // Press Event
                this.painting = true;
                console.log("resume "+tablet.tool_type);

                this.brush(tablet.tool_type).resume();
                this.brush(tablet.tool_type).base_value("color_h", this.editor.color_fg[0]);
                this.brush(tablet.tool_type).base_value("color_s", this.editor.color_fg[1]);
                this.brush(tablet.tool_type).base_value("color_v", this.editor.color_fg[2]);
                mypaint.mypaint_brush_new_stroke(this.brush(tablet.tool_type).brush);
                this.min_x = offset_x; this.min_y = offset_y; this.max_x = offset_x; this.max_y = offset_y;
                this.undo = new LayerBufferUndo(this.editor.image, this.editor.image.current_layer());
                this.surface_extent = new gegl.GeglRectangle();
                let current_extent = gegl.gegl_buffer_get_extent(this.editor.image.current_layer().buffer).deref();
                this.surface_extent.x = current_extent.x;
                this.surface_extent.y = current_extent.y;
                this.surface_extent.width = current_extent.width;
                this.surface_extent.height = current_extent.height;
                this.undo.start();
                ['.tool-box', '.vertical-tool-box', '.horizontal-tool-box'].forEach((i)=>{
                    $(i).css({opacity: 0.3})
                });
            } else {
                // Motion Event
                let dtime = (tablet.time - this.last_event.time)/1000.0;
                let rect = new mypaint.MyPaintRectangle();
                mypaint.mypaint_surface_begin_atomic(this.surface);
                mypaint.mypaint_brush_stroke_to(this.brush(tablet.tool_type).brush, this.surface, offset_x, offset_y, tablet.pressure, tablet.tilt_x, tablet.tilt_y, dtime);
                mypaint.mypaint_surface_end_atomic(this.surface, rect.ref());
                if (rect.width > 0 && rect.height > 0) {
                    if (rect.x < this.min_x) this.min_x = rect.x;
                    if (rect.y < this.min_y) this.min_y = rect.y;
                    if (this.max_x < rect.x + rect.width) this.max_x = rect.x + rect.width;
                    if (this.max_y < rect.y + rect.height) this.max_y = rect.y + rect.height;
                }
                this.last_event = tablet;
                let do_update = () => {
                    this.editor.image.update_async(rect.x, rect.y, rect.width, rect.height);
                }
                if (this.move_count % 5 == 0) {
                    do_update();
                    this.move_count = 0;
                } else {
                    setImmediate(do_update)
                }
                this.move_count ++;
            
            }
        } else {
            if (this.painting) {
                // Release Event
                mypaint.mypaint_brush_reset(this.brush(tablet.tool_type).brush);
                let bounds = new mypaint.MyPaintRectangle();
                this.surface_extent.combine_with(gegl.gegl_buffer_get_extent(this.editor.image.current_layer().buffer).deref());
                gegl.gegl_buffer_set_extent(this.editor.image.current_layer().buffer, this.surface_extent.ref());
                bounds.x = this.min_x;
                bounds.y = this.min_y;
                bounds.width = this.max_x - this.min_x;
                bounds.height = this.max_y - this.min_y;
                this.undo.stop(bounds.x, bounds.y, bounds.width, bounds.height);
                this.editor.image.undos.push(this.undo);
                this.undo = null;
                console.log("update "+bounds.x+","+bounds.y+","+bounds.width+","+bounds.height)
                this.editor.image.update_async(bounds.x, bounds.y, bounds.width, bounds.height);
                ['.tool-box', '.vertical-tool-box',  '.horizontal-tool-box'].forEach((i)=>{
                    $(i).css({opacity: 1.0})
                });
                this.layer_list_view.update();
                console.log("suspend "+tablet.tool_type);
                this.brush(tablet.tool_type).suspend();
            }
            this.painting = false;
        }
    }
    swipe(event) {
        switch (event.event_type) {
            case 'begin':
                this.total_dx = 0;
                this.total_dy = 0;
                console.log("swipe: start: "+this.total_dx+","+this.total_dy);
                break;
            case 'update':
                this.total_dx += event.dx;
                this.total_dy += event.dy;
                break;
            case 'end':
                if (event.cancelled) {

                } else {
                    console.log("swipe: total: "+this.total_dx+","+this.total_dy);
                }
                break;
        };
    };

    on_change_current_layer(group, current_layer) {
        if (this.gegl_surface) {
            mypaint.mypaint_surface_unref(this.gegl_surface);
            mypaint.mypaint_surface_unref(this.surface);
        }
        this.gegl_surface = mypaint.mypaint_gegl_tiled_surface_new();
        mypaint.mypaint_gegl_tiled_surface_set_buffer(this.gegl_surface, current_layer.buffer);
        this.surface = mypaint.mypaint_gegl_tiled_surface_interface(this.gegl_surface);
    }
}