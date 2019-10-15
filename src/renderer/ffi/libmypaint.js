const ffi = require('ffi-napi');
const ref = require('ref-napi');
const Struct = require('ref-struct-di')(ref);

var gegl;
class LibMyPaint {
    constructor(lib_config) {
        this.MyPaintBrush = ref.types.void;
        this.PMyPaintBrush = ref.refType(this.MyPaintBrush);

        this.MyPaintGeglTiledSurface = ref.types.void;
        this.PMyPaintGeglTiledSurface = ref.refType(this.MyPaintGeglTiledSurface);
        this.MyPaintRectangle = Struct({ 'x':'int', 'y':'int', 'width':'int', 'height':'int' });
        this.PMyPaintRectangle = ref.refType(this.MyPaintRectangle);

        this.MyPaintSurface = Struct({
            'draw_dab': ffi.Function('int',['pointer', 'float', 'float', 'float', //x,y,radius
                                            'float', 'float', 'float', // color_r, color_g, color_b
                                            'float', 'float', 'float', 'float', 'float', // opaque, hardness, alpha_eraser, aspect_ratio, angle
                                            'float', 'float']), // lock_alpha, colorize
            'get_color': ffi.Function('void', ['pointer', 'float', 'float', 'float', 
                                              'float *', 'float *', 'float *', 'float *']),
            'begin_atomic': ffi.Function('void', ['pointer']),
            'end_atomic': ffi.Function('void',['pointer', this.PMyPaintRectangle]),
            'destroy': ffi.Function('void', ['pointer']),
            'save_png': ffi.Function('void', ['pointer', 'string', 'int', 'int', 'int', 'int']),
            'refcount': 'int'
        });
        this.PMyPaintSurface = ref.refType(this.MyPaintSurface);

        Object.assign(this, ffi.Library(lib_config['libmypaint'], {
            'mypaint_brush_new': [this.PMyPaintBrush, []],
            'mypaint_brush_unref': ['void', [this.PMyPaintBrush]],
            'mypaint_brush_ref': ['void', [this.PMyPaintBrush]],
            'mypaint_brush_reset': ['void', [this.PMyPaintBrush]],
            'mypaint_brush_new_stroke': ['void', [this.PMyPaintBrush]],
            'mypaint_brush_stroke_to': ['int', [this.PMyPaintBrush, this.PMyPaintSurface, 'float', 'float', 'float', 'float', 'float', 'double']],
            'mypaint_brush_set_base_value': ['void', [this.PMyPaintBrush, 'int', 'float']],
            'mypaint_brush_get_base_value': ['float', [this.PMyPaintBrush, 'int']],
            'mypaint_brush_is_constant': ['bool', [this.PMyPaintBrush, 'int']],
            'mypaint_brush_get_inputs_used_n':['int', [this.PMyPaintBrush, 'int']],
            'mypaint_brush_set_mapping_n':['void', [this.PMyPaintBrush, 'int', 'int', 'int']],
            'mypaint_brush_get_mapping_n':['int', [this.PMyPaintBrush, 'int', 'int']],
            'mypaint_brush_set_mapping_point':['int', [this.PMyPaintBrush, 'int', 'int', 'int', 'float', 'float']],
            'mypaint_brush_get_mapping_point':['void', [this.PMyPaintBrush, 'int', 'int', 'int', 'float *', 'float *']],
            'mypaint_brush_get_state':['float', [this.PMyPaintBrush, 'int']],
            'mypaint_brush_set_state': ['void', [this.PMyPaintBrush, 'int', 'float']],
            'mypaint_brush_get_total_stroke_painting_time': ['double', [this.PMyPaintBrush]],
            'mypaint_brush_set_print_inputs': ['void', [this.PMyPaintBrush, 'bool']],
            'mypaint_brush_from_defaults': ['void', [this.PMyPaintBrush]],
            'mypaint_brush_from_string': ['bool', [this.PMyPaintBrush, 'string']],
            'mypaint_surface_draw_dab': ['int', [this.PMyPaintSurface, 'float', 'float', 'float',
                                                 'float', 'float', 'float',
                                                 'float', 'float', 'float', 'float', 'float',
                                                 'float', 'float']],
            'mypaint_surface_get_color': ['void', [this.PMyPaintSurface, 'float', 'float', 'float',
                                                   'float *', 'float *', 'float *', 'float *']],
            'mypaint_surface_get_alpha': ['float', [this.PMyPaintSurface, 'float', 'float', 'float']],
            'mypaint_surface_save_png': ['void', [this.PMyPaintSurface, 'string', 'int', 'int', 'int', 'int']],
            'mypaint_surface_begin_atomic': ['void', [this.PMyPaintSurface]],
            'mypaint_surface_end_atomic': ['void', [this.PMyPaintSurface, this.PMyPaintRectangle]],
            'mypaint_surface_init': ['void', [this.PMyPaintSurface]],
            'mypaint_surface_ref': ['void', [this.PMyPaintSurface]],
            'mypaint_surface_unref': ['void', [this.PMyPaintSurface]],
        }));
        Object.assign(this, ffi.Library(lib_config['libmypaint-gegl'], {
            'mypaint_gegl_tiled_surface_get_buffer': [gegl.PGeglBuffer, [this.PMyPaintGeglTiledSurface]],
            'mypaint_gegl_tiled_surface_set_buffer': ['void', [this.PMyPaintGeglTiledSurface, gegl.PGeglBuffer]],
            'mypaint_gegl_tiled_surface_interface': [this.PMyPaintSurface, [this.PMyPaintGeglTiledSurface]],
            'mypaint_gegl_tiled_surface_new': [this.PMyPaintGeglTiledSurface, []]
        }));
    }
}

var libmypaint = null;
function init(lib_config, _gegl) {
    if (libmypaint)
        return libmypaint;
    gegl = _gegl;
    libmypaint = new LibMyPaint(lib_config);
    return libmypaint;
}
module.exports = init;