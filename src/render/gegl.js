const ffi = require('ffi-napi');
const ref = require('ref-napi');
const ArrayType = require('ref-array-di')(ref);
const Struct = require('ref-struct-di')(ref);

class Gegl {
    constructor() {
        this.GeglBuffer = ref.types.void;
        this.PGeglBuffer = ref.refType(this.GeglBuffer);
        this.GeglNode = ref.types.void;
        this.PGeglNode = ref.refType(this.GeglNode);
        this.GeglPath = ref.types.void;
        this.PGeglPath = ref.refType(this.GeglPath);
        this.GObject = ref.types.void;
        this.PGObject = ref.refType(this.GObject);
        this.GeglProcessor = ref.types.void;
        this.PGeglProcessor = ref.refType(this.GeglProcessor);
        this.GeglRectangle = Struct({'x': 'int', 'y':'int', 'width':'int', 'height':'int'});
        this.PGeglRectangle = ref.refType(this.GeglRectangle);
        this.Babl = ref.types.void;
        this.PBabl = ref.refType(this.Babl);
        const strings = ArrayType('string');
        // FIXME: Absolute paths for library is required for my environment. Need to be resolved on-demand.
        Object.assign(this, ffi.Library('/usr/lib/x86_64-linux-gnu/libbabl-0.1.so.0', {
            'babl_init': [this.PBabl, ['string']],
            'babl_format': [this.PBabl, ['string']]
        }));
        Object.assign(this, ffi.Library('/usr/lib/libgegl-0.3.so', {
            'gegl_init': ["void", ['int *', strings]],
            'gegl_node_new': [this.PGeglNode, []],
            'gegl_node_new_child':[this.PGeglNode,[this.PGeglNode, 'string'], {varargs: true}],
            'gegl_node_link_many':['void',[this.PGeglNode, this.PGeglNode], {varargs: true}],
            'gegl_node_connect_to':['bool',[this.PGeglNode, 'string', this.PGeglNode, 'string']],
            'gegl_path_new':[this.PGeglPath,[]],
            'gegl_path_append':['void',[this.PGeglPath], {varargs: true}],
            'gegl_path_get_bounds':['void',[this.PGeglPath, 'double *', 'double *', 'double *', 'double *']],
            'gegl_node_new_processor':[this.PGeglProcessor,[this.PGeglNode, this.PGeglRectangle]],
            'gegl_processor_work':['bool',[this.PGeglProcessor, 'double *']],
            'gegl_buffer_new':[this.PGeglBuffer,[this.PGeglRectangle, this.PBabl]],
            'gegl_buffer_linear_open':['pointer',[this.PGeglBuffer, this.PGeglRectangle, 'int *', this.PBabl]],
            'gegl_buffer_linear_close':['void',[this.PGeglBuffer, 'pointer']],
            'gegl_color_new': ['pointer', ['string']],
            'gegl_node_process': ['void', [this.PGeglNode]]
        }));
        Object.assign(this, ffi.Library('/usr/lib/x86_64-linux-gnu/libgobject-2.0.so.0', {
            'g_object_unref': ['void',['pointer']],
        //    'g_signal_connect': [,['pointer']],
        }));
    };

    init() {
        this.gegl_init(null, null);
    }
}

var gegl = new Gegl();
gegl.init();
module.exports = gegl;