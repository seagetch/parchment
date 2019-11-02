const ffi = require('ffi-napi');
const ref = require('ref-napi');
const ArrayType = require('ref-array-di')(ref);
const Struct = require('ref-struct-di')(ref);
import lib_config from '../resources/lib_config'
let gegl;

export class Pad {
    constructor(node, label) {
        this.node = node;
        this.label = label
    }

    connect_to(in_pad) {
        gegl.gegl_node_connect_to(this.node.node, this.label, in_pad.node.node, in_pad.label);
    }
};

export class Node {
    constructor(parent = null, desc = {}) {
        let args = [];
        let types = [];
        for (let i in desc) {
            let v = desc[i];
            if (typeof(v) === 'bigint') {
                types.push('string');
                types.push('int');
                args.push(i.toString())
                args.push(parseInt(v));
            } else if (typeof(v) === 'number') {
                types.push('string');
                types.push('double');
                args.push(i.toString())
                args.push(v);
            } else if (typeof(v) === 'string') {
                types.push('string');
                types.push('string');
                args.push(i.toString())
                args.push(v);
            } else if (typeof(v) === 'function') {
                types.push('string');
                types.push('pointer');
                args.push(i.toString())
                args.push(v);
            } else if (typeof(v) === 'boolean') {
                types.push('string');
                types.push('bool');
                args.push(i.toString())
                args.push(v);
            } else if (typeof(v) === 'undefined') {
                types.push('string');
                types.push('pointer');
                args.push(i.toString())
                args.push(null);
            } else {
                types.push('string');
                types.push('pointer');
                args.push(i.toString())
                args.push(v);
            }
        }
        if (!parent || args.length == 0) {
            this.node = gegl.gegl_node_new();
        } else {
            args.push(null);
            types.push('pointer');
            types.shift();
            this.node = gegl.gegl_node_new_child(...types)(parent.node, ...args);
        }
    }

    ref() {
        return this.node;
    }

    dispose() {
        gegl.g_object_unref(this.node);
    }

    connect_to(...nodes) {
        let types = nodes.map((i)=> { return 'pointer'});
        let args = [this.node].concat(nodes.map((i)=>{return i.node}));
        args.push(null);
        gegl.gegl_node_link_many(...types)(...args);
    }

    aux() {
        return new Pad(this, "aux");
    }

    output() {
        return new Pad(this, "output");
    }

    input() {
        return new Pad(this, "input");
    }

    new_processor(x = null, y = null, w = null, h = null) {
        let rect = null;
        if (x != null && y != null && w != null && h !=null) {
            rect = new gegl.GeglRectangle();
            rect.x = x; rect.y = y;
            rect.width = w; rect.height = h;
        }
        return gegl.gegl_node_new_processor(this.node, rect? rect.ref(): null);
    }

    process() {
        gegl.gegl_node_process(this.node);
    }

    process_async(callback) {
        gegl.gegl_node_process.async(this.node, callback);
    }

    blit(rect, dest, babl=null) {
        gegl.gegl_node_blit(this.node, 1.0, rect? rect.ref(): null, babl? babl: gegl.babl_format("R'G'B'A u8"), dest, parseInt(gegl.GEGL_AUTO_ROWSTRIDE), parseInt(gegl.GEGL_BLIT_DEFAULT));
    }

    bounding_box() {
        return gegl.gegl_node_get_bounding_box(this.node);
    }
};
export class Gegl {
    constructor(lib_config) {
        let gegl = this;

        gegl.GeglBuffer = ref.types.void;
        gegl.PGeglBuffer = ref.refType(gegl.GeglBuffer);
        gegl.GeglNode = ref.types.void;
        gegl.PGeglNode = ref.refType(gegl.GeglNode);
        gegl.GeglPath = ref.types.void;
        gegl.PGeglPath = ref.refType(gegl.GeglPath);
        gegl.GObject = ref.types.void;
        gegl.PGObject = ref.refType(gegl.GObject);
        gegl.GeglProcessor = ref.types.void;
        gegl.PGeglProcessor = ref.refType(gegl.GeglProcessor);
        gegl.GeglRectangle = Struct({'x': 'int', 'y':'int', 'width':'int', 'height':'int'});
        gegl.PGeglRectangle = ref.refType(gegl.GeglRectangle);
        gegl.Babl = ref.types.void;
        gegl.PBabl = ref.refType(gegl.Babl);
        gegl.GeglColor = ref.types.void;
        gegl.PGeglColor = ref.refType(gegl.GeglColor);

        gegl.GEGL_ABYSS_NONE  = BigInt(0);
        gegl.GEGL_ABYSS_CLAMP = BigInt(1);
        gegl.GEGL_ABYSS_LOOP  = BigInt(2);
        gegl.GEGL_ABYSS_BLACK = BigInt(3);
        gegl.GEGL_ABYSS_WHITE = BigInt(4);

        gegl.GEGL_ACCESS_READ      = BigInt(1 << 0);
        gegl.GEGL_ACCESS_WRITE     = BigInt(1 << 1);
        gegl.GEGL_ACCESS_READWRITE = BigInt(gegl.GEGL_ACCESS_READ | gegl.GEGL_ACCESS_WRITE);

        gegl.GEGL_ORIENTATION_HORIZONTAL = BigInt(0);
        gegl.GEGL_ORIENTATION_VERTICAL   = BigInt(1);

        gegl.GEGL_DITHER_NONE                     = BigInt(0);
        gegl.GEGL_DITHER_FLOYD_STEINBERG          = BigInt(1);
        gegl.GEGL_DITHER_BAYER                    = BigInt(2);
        gegl.GEGL_DITHER_RANDOM                   = BigInt(3);
        gegl.GEGL_DITHER_RANDOM_COVARIANT         = BigInt(4);
        gegl.GEGL_DITHER_ARITHMETIC_ADD           = BigInt(5);
        gegl.GEGL_DITHER_ARITHMETIC_ADD_COVARIANT = BigInt(6);
        gegl.GEGL_DITHER_ARITHMETIC_XOR           = BigInt(7);
        gegl.GEGL_DITHER_ARITHMETIC_XOR_COVARIANT = BigInt(8);

        gegl.GEGL_SAMPLER_NEAREST = BigInt(0);
        gegl.GEGL_SAMPLER_LINEAR  = BigInt(1);
        gegl.GEGL_SAMPLER_CUBIC   = BigInt(2);
        gegl.GEGL_SAMPLER_NOHALO  = BigInt(3);
        gegl.GEGL_SAMPLER_LOHALO  = BigInt(4);

        gegl.GEGL_AUTO_ROWSTRIDE = BigInt(0);

        gegl.GEGL_BLIT_DEFAULT  = BigInt(0);
        gegl.GEGL_BLIT_CACHE    = BigInt(1 << 0);
        gegl.GEGL_BLIT_DIRTY    = BigInt(1 << 1);

        const strings = ArrayType('string');
        // FIXME: Absolute paths for library is required for my environment. Need to be resolved on-demand.
        Object.assign(gegl, ffi.Library(lib_config['libbabl'], {
            'babl_init': [gegl.PBabl, ['string']],
            'babl_format': [gegl.PBabl, ['string']]
        }));
        Object.assign(gegl, ffi.Library(lib_config['libgegl'], {
            'gegl_init': ["void", ['int *', strings]],
            'gegl_node_new': [gegl.PGeglNode, []],
            'gegl_node_new_child':[gegl.PGeglNode,[gegl.PGeglNode, 'string'], {varargs: true}],
            'gegl_node_link_many':['void',[gegl.PGeglNode, gegl.PGeglNode], {varargs: true}],
            'gegl_node_connect_to':['bool',[gegl.PGeglNode, 'string', gegl.PGeglNode, 'string']],
            'gegl_path_new':[gegl.PGeglPath,[]],
            'gegl_path_append':['void',[gegl.PGeglPath], {varargs: true}],
            'gegl_path_get_bounds':['void',[gegl.PGeglPath, 'double *', 'double *', 'double *', 'double *']],
            'gegl_node_new_processor':[gegl.PGeglProcessor,[gegl.PGeglNode, gegl.PGeglRectangle]],
            'gegl_node_get_bounding_box':[gegl.GeglRectangle, [gegl.PGeglNode]],
            'gegl_processor_work':['bool',[gegl.PGeglProcessor, 'double *']],
            'gegl_buffer_new':[gegl.PGeglBuffer,[gegl.PGeglRectangle, gegl.PBabl]],
            'gegl_buffer_linear_open':['pointer',[gegl.PGeglBuffer, gegl.PGeglRectangle, 'int *', gegl.PBabl]],
            'gegl_buffer_linear_close':['void',[gegl.PGeglBuffer, 'pointer']],
            'gegl_buffer_get_extent':[gegl.PGeglRectangle, [gegl.PGeglBuffer]],
            'gegl_buffer_get_abyss':[gegl.PGeglRectangle, [gegl.PGeglBuffer]],
            'gegl_buffer_set_extent':['void', [gegl.PGeglBuffer, gegl.PGeglRectangle]],
            'gegl_buffer_set_abyss': ['void', [gegl.PGeglBuffer, gegl.PGeglRectangle]],
            'gegl_buffer_clear': ['void', [gegl.PGeglBuffer, gegl.PGeglRectangle]],
            'gegl_color_new': ['pointer', ['string']],
            'gegl_node_process': ['void', [gegl.PGeglNode]],
            'gegl_node_blit': ['void', [gegl.PGeglNode, 'double', gegl.PGeglRectangle, gegl.PBabl, 'pointer', 'int', 'int']],
            'gegl_color_new': [gegl.PGeglColor, ['string']],
            'gegl_rectangle_bounding_box': ['void', [gegl.PGeglRectangle, gegl.PGeglRectangle, gegl.PGeglRectangle]],
            'gegl_rectangle_intersect': ['void', [gegl.PGeglRectangle, gegl.PGeglRectangle, gegl.PGeglRectangle]],
        }));
        Object.assign(gegl, ffi.Library(lib_config['libgobject'], {
            'g_object_unref': ['void',['pointer']],
        //    'g_signal_connect': [,['pointer']],
        }));

        gegl.GeglRectangle.prototype.combine_with = function(r) {
            gegl.gegl_rectangle_bounding_box(this.ref(), this.ref(), r.ref());
            return this;
        }
        gegl.GeglRectangle.prototype.intersect_with = function(r) {
            gegl.gegl_rectangle_intersect(this.ref(), this.ref(), r.ref());
            return this;
        }
    };

    init() {
        this.gegl_init(null, null);
    }

    node() {
        return new Node();
    }

    node(parent, desc) {
        return new Node(parent, desc);
    }

    with_buffer(object, callback) {
        let result = callback(object);
        this.g_object_unref(object);
        return result;
    }
    with_node(callback) {
        let top_node = this.node();
        let result = callback(top_node);
        top_node.dispose();
        return result;
    }
}

function init(lib_config) {
    if (gegl)
        return gegl;

    if (lib_config) {
        console.log("Create new gegl inistance.")
        gegl = new Gegl(lib_config);
        gegl.init();
    } else {
        console.error("No lib_config information.");
    }
    return gegl;
}

export default gegl = init(lib_config);