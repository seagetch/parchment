import gegl from '../../ffi/gegl';
import RasterImage from '../image';
import RasterLayer from '../layer';
import LayerGroup from '../layergroup';
const cheerio = require('cheerio');
const archiver = require('archiver');
const fs = require('fs');
const os = require('os');
const path = require('path');
const UUID = require('pure-uuid');
const rimraf = require('rimraf');

export function save(image, filename) {
    let tempdir = path.join(os.tmpdir(), "parchment-"+new UUID(4).format());
    let tempdatadir = path.join(tempdir, "data");
    let tempthumbdir = path.join(tempdir, "Thumbnails");
    fs.mkdirSync(tempdir);
    fs.mkdirSync(tempdatadir);
    fs.mkdirSync(tempthumbdir);
    var output = fs.createWriteStream(filename);
    let archive = archiver('zip', {
        zlib: { level: 9 }
    });
    archive.pipe(output);

    let ch = cheerio.load("<?xml version='1.0' encoding='UTF-8'?><image version='0.0.5' ><stack /></image>", {
        xml: { normalizeWhitespace: true }
    });
    let image_struct  = ch("image");
    image_struct.attr({w: image.width, h: image.height});
    
    // Traverse Layers
    let traverse = async (group, current_stack, level) => {
        for (let i = group.length - 1; i >= 0; i --) {
            let layer = group[i];
            if (layer instanceof LayerGroup) {
                let layer_name = "group-"+level+"-"+i;
                let stack = ch("<stack>").attr({
                    name: layer_name, x: 0, y: 0, opacity: 1.0, "composite-op": layer.compositor
                }).appendTo(current_stack);
                await traverse(layer, stack, level+"-"+i);
            } else if (layer instanceof RasterLayer) {
                let layer_name = "layer-"+level+"-"+i;
                let extent = gegl.gegl_buffer_get_extent(layer.buffer).deref();
                ch("<layer>").attr({
                    name: layer_name, x: extent.x - layer.x, y: extent.y - layer.y, src: "data/"+layer_name+".png", opacity: 1.0, "composite-op": layer.compositor
                }).appendTo(current_stack);
                
                await new Promise((resolve, reject) =>{
                    let temp_name = path.join(tempdatadir, layer_name+".png");
                    console.log(temp_name);
                    let top_node = gegl.node();
                    console.log("src")
                    let src  = gegl.node(top_node, {operation: 'gegl:buffer-source', buffer: layer.buffer});
                    console.log("save")
                    let save = gegl.node(top_node, {operation: 'gegl:png-save', path: temp_name});
                    console.log("connect")
                    src.connect_to(save);
                    console.log("process")
                    save.process_async((err, _)=>{
                        top_node.dispose();
                        resolve();
                    });
                });
            }
        }
        return;
    }
    
    traverse(image.layers, image_struct.find("stack"), "0").then(()=>{
        let export_merged = async () =>{
            console.log("Traversed")
            // Export merged image
            await new Promise((resolve, reject)=>{
                let top_node = gegl.node();
                let temp_name = path.join(tempdir, "mergedimage.png");
                let src  = gegl.node(top_node, {operation: 'gegl:buffer-source', buffer: image.buffer});
                let save = gegl.node(top_node, {operation: 'gegl:png-save', path: temp_name});
                src.output().connect_to(save.input());
                save.process_async(()=>{ top_node.dispose(); resolve() });
            });
            // Export thumbnail.
            await new Promise((resolve, reject)=>{
                let top_node = gegl.node();
                let thumb_x, thumb_y;
                if (image.width > image.height) {
                    thumb_x = 256;
                    thumb_y = 256 * image.height / image.width;
                } else {
                    thumb_y = 256;
                    thumb_x = 256 * image.width / image.height;
                }
        
                let temp_name = path.join(tempthumbdir, "thumnail.png");
                let src   = gegl.node(top_node, {operation: 'gegl:buffer-source', buffer: image.buffer});
                let scale = gegl.node(top_node, {operation: 'gegl:scale-size', sampler: gegl.GEGL_SAMPLER_CUBIC, x: thumb_x, y: thumb_y })
                let save  = gegl.node(top_node, {operation: 'gegl:png-save', path: temp_name});
                src.connect_to(scale, save);
                save.process_async(()=>{ top_node.dispose(); resolve() });
            });
            return;
        };
        return export_merged();
    }).then(()=>{
        archive.append("image/openraster", {name: "mimetype"});
        archive.append(ch.xml(), {name: "stack.xml"});
        archive.directory(tempdatadir, 'data');
        archive.directory(tempthumbdir, 'Thumbnails');
        archive.file(path.join(tempdir, "mergedimage.png"))
        archive.finalize();
    });
    output.on("close", ()=>{
        console.log("written file.");
        rimraf(tempdir, (err)=>{});
    })
}

export function load(filename) {
}