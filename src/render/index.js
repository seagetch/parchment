const { ipcRenderer } = require('electron')
const electron = require('electron');
const ref = require('ref-napi');
const Struct = require('ref-struct-di')(ref);
const ArrayType = require('ref-array-di')(ref);
const gegl = require('./gegl.js');
const LibInput = require('./libinput.js')

var gnode;
var buffer;
var top_node;
var out_node;
function run_gegl() {
    console.log("run_gegl")
    var rect = new gegl.GeglRectangle();
    rect.x = 0, rect.y = 0;
    rect.width = $("#canvas")[0].width
    rect.height = $("#canvas")[0].height
    console.log("Create canvas of size "+rect.width + ","+rect.height)
    buffer = gegl.gegl_buffer_new(rect.ref(), gegl.babl_format("R'G'B'A u8"));
    var buf  = gegl.gegl_buffer_linear_open(buffer, null, null, gegl.babl_format("Y' u8"));
    var buf2 = ref.reinterpret(buf, canvas.width*canvas.height, 0);
    buf2.type = ref.types.uint8;
    buf2.fill(255);
    gegl.gegl_buffer_linear_close(buffer, buf);

    gnode = gegl.gegl_node_new();
    top_node = gegl.gegl_node_new_child('string', 'string', 'pointer', 'pointer')(gnode, "operation", "gegl:buffer-source", "buffer", buffer, null);
    out_node  = gegl.gegl_node_new_child('string', 'pointer')(gnode, "operation", "gegl:nop", null);
    gegl.gegl_node_link_many('pointer')(top_node, out_node, null);

    //g_object_unref(gnode);
    //g_object_unref(buffer);

}

var vector = null;
var over_node, stroke;
var rendering = false;
function tablet_motion(ev, tablet) {
    let canvas = $("#canvas")[0];
    let client = canvas.getBoundingClientRect();
    let offset_x = tablet.x - (client.left + window.screenLeft);
    let offset_y = tablet.y - (client.top + window.screenTop);
    if (tablet.pressure > 0) {
        if (!vector) {
            console.log("press")
            // press event
            vector     = gegl.gegl_path_new();
            over_node  = gegl.gegl_node_new_child('string', 'pointer')(gnode, "operation", "gegl:over", null);
            stroke     = gegl.gegl_node_new_child('string', 
                                                  'string', 'pointer', 
                                                  'string', 'double', 
                                                  'string', 'pointer', 
                                                  'string', 'double',
                                                  'string', 'double',
                                                  'pointer')(
                                             gnode, "operation", 
                                             "gegl:path",
                                             "d", vector,
                                             "fill-opacity", 0.0,
                                             "stroke", gegl.gegl_color_new("rgba(.5, .5, .5, 0.8)"),
                                             "stroke-width", 60,
                                             "stroke-hardness", 0.6,
                                             null);
            gegl.gegl_node_link_many('pointer', 'pointer')(top_node, over_node, out_node, null);
            gegl.gegl_node_connect_to(stroke, "output", over_node, "aux");
            gegl.gegl_path_append('char', 'double', 'double', 'pointer')(vector, 'M', offset_x, offset_y, null);
        } else {
            console.log("motion")
            // motion event
            gegl.gegl_path_append('char', 'double', 'double', 'pointer')(vector, 'L', offset_x, offset_y, null);
        }
    } else {
        if (vector) {
            if (!rendering) {
                rendering = true;
                console.log("release")
                // rlease event
                let roi = new gegl.GeglRectangle();
                let x0 = ref.alloc('double'), y0 = ref.alloc('double')
                let x1 = ref.alloc('double'), y1 = ref.alloc('double')
                gegl.gegl_path_get_bounds(vector, x0, x1, y0, y1);

                roi.x = x0.deref() - 60;
                roi.y = y0.deref() - 60;
                roi.width = x1.deref() - x0.deref() + 60 * 2;
                roi.height = y1.deref() - y0.deref() + 60 * 2;

                let writebuf = gegl.gegl_node_new_child('string', 'string', 'pointer', 'pointer')(
                                            gnode, "operation", 
                                            "gegl:write-buffer",
                                            "buffer",    buffer,
                                            null);
                gegl.gegl_node_link_many('pointer')(over_node, writebuf, null);

    //            let processor = gegl.gegl_node_new_processor(writebuf, roi.ref());
                gegl.gegl_node_process.async(writebuf, () => {
//                    gegl.g_object_unref(processor);
                    gegl.g_object_unref(writebuf);
        
                    gegl.gegl_node_link_many('pointer')(top_node, out_node, null);
                    gegl.g_object_unref(over_node);
                    gegl.g_object_unref(stroke);
                    rendering = false;
                    over_node = null;
                    stroke   = null;
                    vector = null;

                    let ctx = canvas.getContext("2d");
                    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    let destBuf = Buffer.from(imageData.data.buffer);
                    destBuf.fill(192); // check whether destBuf and putImage works well.
                    console.log("linear_open")
                    let stride = ref.alloc("int")
                    var buf  = gegl.gegl_buffer_linear_open(buffer, null, stride, gegl.babl_format("R'G'B'A u8"));
                    console.log("Buffer.from: w="+canvas.width+",h="+canvas.height);
                    var buf2 = ref.reinterpret(buf, canvas.width * canvas.height * 4, 0);
//                    var rawBuffer = Buffer.from(buf, 0, canvas.width * canvas.height * 4);
                    console.log("dump")
                    console.log("copy")
                    try {
                        buf2.copy(destBuf, 0, 0, canvas.width * canvas.height * 4);
                    } catch(e) {
                        console.log(e)
                    }
                    console.log("linear_close")
                    gegl.gegl_buffer_linear_close(buffer, buf);

                    ctx.putImageData(imageData, 0, 0);
                
                    console.log("done paint");
                });
            }
        }
    }


//    ctx.fillStyle="white";
//    ctx.beginPath();
//    let offset_x = tablet.x - (client.left + window.screenLeft);
//    let offset_y = tablet.y - (client.top + window.screenTop);
//    ctx.arc(offset_x, offset_y, 20 * tablet.pressure, 0, Math.PI*2, false);
//    ctx.fill();
}    

var libinput;
function run_libinput(screen_size) {
    libinput = new LibInput(['/dev/input/event3']);
    libinput.current_bounds = screen_size;
    libinput.watch(tablet_motion);
}

$(window).on("load", () =>{
    run_gegl();
})

ipcRenderer.on("screen-size", (event, bounds) => {
    run_libinput(bounds);
})
ipcRenderer.send("start");