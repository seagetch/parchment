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
const yauzl = require("yauzl");
const rimraf = require('rimraf');
const ref = require('ref-napi')

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
                console.log("extent:"+extent.x+","+extent.y+","+extent.width+","+extent.height)
                ch("<layer>").attr({
                    name: layer_name, x: extent.x - (layer.x? layer.x:0), y: extent.y - (layer.y? layer.y:0), src: "data/"+layer_name+".png", opacity: 1.0, "composite-op": layer.compositor
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
        console.log(ch.xml())
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
        archive.file(path.join(tempdir, "mergedimage.png"), {name: "mergedimage.png"})
        archive.finalize();
    });
    output.on("close", ()=>{
        console.log("written file.");
        rimraf(tempdir, (err)=>{});
    })
}

export function load(filename) {
    return new Promise((resolve, reject)=>{
        let tempdir = path.join(os.tmpdir(), "parchment-"+new UUID(4).format());
        let tempdatadir = path.join(tempdir, "data");
        let tempthumbdir = path.join(tempdir, "Thumbnails");
        fs.mkdirSync(tempdir);
        fs.mkdirSync(tempdatadir);
        fs.mkdirSync(tempthumbdir);

        yauzl.open(filename, {lazyEntries: true}, (err, zipfile)=>{
            if (err)
                throw err;
            zipfile.readEntry();
            zipfile.on("entry", function(entry) {
                if (/\/$/.test(entry.fileName)) {
                    // Directory file names end with '/'.
                    zipfile.readEntry();
                } else {
                    // file entry
                    zipfile.openReadStream(entry, (err, stream)=>{
                        if (err) throw err;
                        stream.on("end", function() { zipfile.readEntry(); });
                        console.log("Write file '"+entry.fileName+"'")  
                        let output = fs.createWriteStream(path.join(tempdir, entry.fileName));
                        stream.pipe(output);
                    });
                }
            });
            zipfile.once("end", function() {
                zipfile.close();
                let ch = cheerio.load(fs.readFileSync(path.join(tempdir, "stack.xml"), 'utf8'), {
                    xml: { normalizeWhitespace: true }
                });
                let image_struct = ch("image");
                let w = image_struct.attr("w");
                let h = image_struct.attr("h");
                let result = new RasterImage(w, h);
                let stack = ch("image").children("stack").first();
                let tasks = [];
                console.log(ch.xml())
                let traverse = (stack, group) =>{
                    stack.children("layer").each((i, raw_layer)=>{
                        let new_layer = new RasterLayer(0, 0, -1, -1);
                        let layer = ch(raw_layer);
                        new_layer.compositor = layer.attr()["composite-op"];
                        group.insert_layer(new_layer, 0);
                        let img_src = path.join(tempdir, layer.attr().src);
                        let top_node = gegl.node();
                        let load = gegl.node(top_node, {operation: 'gegl:png-load', path: img_src});
                        let translate = gegl.node(top_node, {
                            'operation': 'gegl:translate', 
                            'x': parseFloat(layer.attr().x), 
                            'y': parseFloat(layer.attr().y), 
                            'sampler': gegl.GEGL_SAMPLER_NEAREST
                        });
                        let store = gegl.node(top_node, {operation: 'gegl:write-buffer', buffer: new_layer.buffer});
                        console.log("translate:"+layer.attr().x+","+layer.attr().y);
                        load.connect_to(translate, store);
                        tasks.push(new Promise((resolve, reject)=>{
                            store.process_async(()=>{
                                top_node.dispose();
                                let extent = gegl.gegl_buffer_get_extent(new_layer.buffer).deref();
                                console.log(i+": extent:"+extent.x+","+extent.y+","+extent.width+","+extent.height)
                                resolve();
                            });
                        }));
                    });
                    stack.children("stack").each((i, raw_sub_stack)=>{
                        let sub_stack = ch(raw_sub_stack);
                        let new_stack = new LayerGroup(0, 0, w, h);
                        group.add_layer(new_stack);
                        traverse(sub_stack, new_stack);
                    });
                };
                traverse(stack, result);
                Promise.all(tasks).then(()=>{
                    rimraf(tempdir, (err)=>{});
                    resolve(result);
                });
            });
        });
    });

}