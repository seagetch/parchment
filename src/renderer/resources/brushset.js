const mypaint = require('../ffi/libmypaint');
const path = require('path');
const glob = require('glob');
const fs = require('fs');

class Brush {
    constructor(filepath) {
        this.filepath = filepath;
        this.icon = path.join(path.dirname(filepath), path.basename(filepath, '.myb'))+"_prev.png";
        this.brush = mypaint.mypaint_brush_new();
        let brush_config = fs.readFileSync(filepath, 'utf8');
        mypaint.mypaint_brush_from_string(this.brush, brush_config);
        this.name = path.basename(filepath);
    }

    dispose() {
        mypaint.mypaint_brush_unref(brush);
    }
};

function read_brushes(base_path) {
    brush_paths = glob.sync(path.join(base_path, "**/*.myb"))
    brushes = brush_paths.map((i)=>{ return new Brush(i)});
    let result = {};
    for (let i = 0; i < brushes.length; i ++) {
        let brush = brushes[i];
        result[brush.name] = brush;
    }
    return result;
}

module.exports = read_brushes;