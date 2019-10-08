const { ipcRenderer } = require('electron')
const electron = require('electron');
const ref = require('ref-napi');
const Struct = require('ref-struct-di')(ref);
const ArrayType = require('ref-array-di')(ref);
const gegl = require('./gegl.js');
const LibInput = require('./libinput.js');
const mypaint = require('./libmypaint.js')

var gnode;
var buffer;
var top_node;
var out_node;

var dirty = false;
var move_count = 0;
var queued = null;

function blit(canvas, direct = false, drect=null) {
    do_blit = () => {
        if (drect && (direct.width == 0 || drect.height == 0))
            return;
//        if (drect)
//            console.log("rect="+drect.x+","+drect.y+"-"+drect.width+","+drect.height)
//        if (dirty) {
            let ctx = canvas.getContext("2d");
            let imageData = (!drect)? ctx.getImageData(0, 0, canvas.width, canvas.height): ctx.getImageData(drect.x, drect.y, drect.width, drect.height);
            let destBuf = Buffer.from(imageData.data.buffer);
            let stride = ref.alloc("int")
            let rect = new gegl.GeglRectangle();
            if (!drect) {
                rect.x = 0; rect.y = 0; rect.width = canvas.width; rect.height = canvas.height;
            } else {
                rect.x = drect.x; rect.y = drect.y; rect.width = drect.width; rect.height = drect.height;
            }
            var buf  = gegl.gegl_buffer_linear_open(buffer, rect.ref(), stride, gegl.babl_format("R'G'B'A u8"));
            let st = stride.deref();
            var buf2 = ref.reinterpret(buf, st * rect.height * 4, 0);
            if (st == rect.width * 4) {
                buf2.copy(destBuf, 0, 0, rect.width * rect.height * 4);
            } else {
                for (let y = 0; y < rect.height; y ++)
                    buf2.copy(destBuf, rect.width * y * 4, st * y, st * (y + 1));
            }
            gegl.gegl_buffer_linear_close(buffer, buf);

            ctx.putImageData(imageData, rect.x, rect.y);
            dirty = false;
//        }
        queued = null;
    };
    if (direct || move_count % 1000 == 0) {
        if (queued)
            window.clearTimeout(queued)
        do_blit();
    } else if (!queued) {
        setImmediate(do_blit)
//        queued = window.setTimeout(do_blit, 100);
    }
    move_count ++;
}


function run_gegl() {
    console.log("run_gegl")
    var rect = new gegl.GeglRectangle();
    rect.x = 0, rect.y = 0;
    rect.width = $("#canvas")[0].width
    rect.height = $("#canvas")[0].height
    console.log("Create canvas of size "+rect.width + ","+rect.height)
    buffer = gegl.gegl_buffer_new(rect.ref(), gegl.babl_format("R'aG'aB'aA u15"));
    var buf  = gegl.gegl_buffer_linear_open(buffer, rect.ref(), null, gegl.babl_format("Y' u8"));
    var buf2 = ref.reinterpret(buf, canvas.width*canvas.height, 0);
    buf2.type = ref.types.uint8;
    buf2.fill(255);
    gegl.gegl_buffer_linear_close(buffer, buf);

    gnode = gegl.gegl_node_new();
    top_node = gegl.gegl_node_new_child('string', 'string', 'pointer', 'pointer')(gnode, "operation", "gegl:buffer-source", "buffer", buffer, null);
    out_node  = gegl.gegl_node_new_child('string', 'pointer')(gnode, "operation", "gegl:nop", null);
    gegl.gegl_node_link_many('pointer')(top_node, out_node, null);

    blit($("#canvas")[0], true)
    //g_object_unref(gnode);
    //g_object_unref(buffer);
}

var brush;
var gegl_surface;
var surface;

function run_mypaint() {
    brush = mypaint.mypaint_brush_new();
    mypaint.mypaint_brush_from_defaults(brush);
    gegl_surface = mypaint.mypaint_gegl_tiled_surface_new();
    mypaint.mypaint_gegl_tiled_surface_set_buffer(gegl_surface, buffer);
    surface = mypaint.mypaint_gegl_tiled_surface_interface(gegl_surface);
}

var vector = null;
var over_node, stroke;
var rendering = false;
var last_event = {x: 0, y: 0, time: 0}
function tablet_motion(ev, tablet) {
    let canvas = $("#canvas")[0];
    let client = canvas.getBoundingClientRect();
    let offset_x = tablet.x - (client.left + window.screenLeft);
    let offset_y = tablet.y - (client.top + window.screenTop);
    if (tablet.pressure > 0) {
        if (!vector) {
            vector = true;
            console.log("press")
            mypaint.mypaint_brush_new_stroke(brush);
            dirty = true;
        } else {
            console.log("motion")
            let dtime = (tablet.time - last_event.time)/1000.0;
            let rect = new mypaint.MyPaintRectangle();
            mypaint.mypaint_surface_begin_atomic(surface);
            mypaint.mypaint_brush_stroke_to(brush, surface, offset_x, offset_y, tablet.pressure, tablet.tilt_x, tablet.tilt_y, dtime);
            mypaint.mypaint_surface_end_atomic(surface, rect.ref());
            last_event = tablet;
            dirty = true;
            blit(canvas, false, rect);
    
            // motion event
        }
    } else {
        if (vector) {
            console.log("release")
            mypaint.mypaint_brush_reset(brush);
            blit(canvas,true);
        }
        vector = false;
    }
}    

var libinput;
function run_libinput(screen_size) {
    libinput = new LibInput(['/dev/input/event3']);
    libinput.current_bounds = screen_size;
    libinput.watch(tablet_motion);
}

$(window).on("load", () =>{
    run_gegl();
    run_mypaint();
    ipcRenderer.send("start");
})

ipcRenderer.on("screen-size", (event, bounds) => {
    run_libinput(bounds);
})
