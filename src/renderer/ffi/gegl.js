const ffi = require('ffi-napi');
const ref = require('ref-napi');
const ArrayType = require('ref-array-di')(ref);
const Struct = require('ref-struct-di')(ref);

var gegl;

class Pad {
    constructor(node, label) {
        this.node = node;
        this.label = label
    }

    connect_to(in_pad) {
        gegl.gegl_node_connect_to(this.node.node, this.label, in_pad.node.node, in_pad.label);
    }
};

class Node {
    constructor(parent = null, desc = {}) {
        let args = [];
        let types = [];
        for (let i in desc) {
            let v = desc[i];
            if (typeof(v) === 'bigint') {
                console.log("type: int")
                types.push('string');
                types.push('int');
                args.push(i.toString())
                args.push(parseInt(v));
            } else if (typeof(v) === 'number') {
                types.push('string');
                console.log("type: double")
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

    blit(rect, dest, babl=null) {
        gegl.gegl_node_blit(this.node, 1.0, rect? rect.ref(): null, babl? babl: gegl.babl_format("R'G'B'A u8"), dest, parseInt(gegl.GEGL_AUTO_ROWSTRIDE), parseInt(gegl.GEGL_BLIT_DEFAULT));
    }
};

class Gegl {
    constructor(lib_config) {
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

        this.GEGL_ABYSS_NONE  = BigInt(0);
        this.GEGL_ABYSS_CLAMP = BigInt(1);
        this.GEGL_ABYSS_LOOP  = BigInt(2);
        this.GEGL_ABYSS_BLACK = BigInt(3);
        this.GEGL_ABYSS_WHITE = BigInt(4);

        this.GEGL_ACCESS_READ      = BigInt(1 << 0);
        this.GEGL_ACCESS_WRITE     = BigInt(1 << 1);
        this.GEGL_ACCESS_READWRITE = BigInt(this.GEGL_ACCESS_READ | this.GEGL_ACCESS_WRITE);

        this.GEGL_ORIENTATION_HORIZONTAL = BigInt(0);
        this.GEGL_ORIENTATION_VERTICAL   = BigInt(1);

        this.GEGL_DITHER_NONE                     = BigInt(0);
        this.GEGL_DITHER_FLOYD_STEINBERG          = BigInt(1);
        this.GEGL_DITHER_BAYER                    = BigInt(2);
        this.GEGL_DITHER_RANDOM                   = BigInt(3);
        this.GEGL_DITHER_RANDOM_COVARIANT         = BigInt(4);
        this.GEGL_DITHER_ARITHMETIC_ADD           = BigInt(5);
        this.GEGL_DITHER_ARITHMETIC_ADD_COVARIANT = BigInt(6);
        this.GEGL_DITHER_ARITHMETIC_XOR           = BigInt(7);
        this.GEGL_DITHER_ARITHMETIC_XOR_COVARIANT = BigInt(8);

        this.GEGL_SAMPLER_NEAREST = BigInt(0);
        this.GEGL_SAMPLER_LINEAR  = BigInt(1);
        this.GEGL_SAMPLER_CUBIC   = BigInt(2);
        this.GEGL_SAMPLER_NOHALO  = BigInt(3);
        this.GEGL_SAMPLER_LOHALO  = BigInt(4);

        this.GEGL_AUTO_ROWSTRIDE = BigInt(0);

        this.GEGL_BLIT_DEFAULT  = BigInt(0);
        this.GEGL_BLIT_CACHE    = BigInt(1 << 0);
        this.GEGL_BLIT_DIRTY    = BigInt(1 << 1);

        const strings = ArrayType('string');
        // FIXME: Absolute paths for library is required for my environment. Need to be resolved on-demand.
        Object.assign(this, ffi.Library(lib_config['libbabl'], {
            'babl_init': [this.PBabl, ['string']],
            'babl_format': [this.PBabl, ['string']]
        }));
        Object.assign(this, ffi.Library(lib_config['libgegl'], {
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
            'gegl_buffer_get_extent':[this.PGeglRectangle, [this.PGeglBuffer]],
            'gegl_color_new': ['pointer', ['string']],
            'gegl_node_process': ['void', [this.PGeglNode]],
            'gegl_node_blit': ['void', [this.PGeglNode, 'double', this.PGeglRectangle, this.PBabl, 'pointer', 'int', 'int']]
        }));
        Object.assign(this, ffi.Library(lib_config['libgobject'], {
            'g_object_unref': ['void',['pointer']],
        //    'g_signal_connect': [,['pointer']],
        }));
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

var gegl = null;
function init(lib_config) {
    if (gegl)
        return gegl;
    gegl = new Gegl(lib_config);
    gegl.init();
    return gegl;
}
module.exports = init;