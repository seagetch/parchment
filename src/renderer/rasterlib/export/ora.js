import RasterImage from '../image';
import RasterLayer from '../layer';
import LayerGroup from '../layergroup';
const cheerio = require('cheerio');

export class ExportOra {
    constructor(image) {
        this.image = image;
    }
    process(filename) {
        let ch = cheerio.load("<?xml version='1.0' encoding='UTF-8'?><image version='0.0.5' ><stack /></image>", {
            xml: {
              normalizeWhitespace: true,
            }});
        let image_struct  = ch("image");
        image_struct.attr({w: this.image.width, h: this.image.height});
        
        let traverse = (group, current_stack) => {
            for (let i = group.length - 1; i >= 0; i --) {
                let layer = group[i];
                if (layer instanceof LayerGroup) {
                    let stack = ch("<stack>").attr({
                        name: "layer-"+i, x: 0, y: 0, src: "", opacity: 1.0, "composite-op": layer.compositor
                    }).appendTo(current_stack);
                    traverse(layer, stack);
                } else if (layer instanceof RasterLayer) {
                    ch("<layer>").attr({
                        name: "layer-"+i+".png", x: 0, y: 0, src: "", opacity: 1.0, "composite-op": layer.compositor
                    }).appendTo(current_stack);
                }
            }
        }
        traverse(this.image.layers, image_struct.find("stack"));
        console.log(ch.xml());
    }
};