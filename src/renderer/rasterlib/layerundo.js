import gegl from '../ffi/gegl';

export class InsertLayerUndo {
    constructor(layer, group, index) {
        this.group = group;
        this.layer = layer;
        this.index = index;
    }
    undo() {
        this.group.remove_layer(this.layer);
        return null;
    }
    redo() {
        this.group.insert_layer(this.layer, this.index);
        return null;
    }
    dispose() {
        if (this.layer) {
            let layer = this.layer;
            if (layer.parent) {
                if (!layer.parent.layers.indexOf(layer)) {
                    layer.dispose();
                }
            } else {
                layer.dispose();
            }
        }
        this.layer = null;
    }
}

export class RemoveLayerUndo {
    constructor(layer, group, index) {
        this.group = group;
        this.layer = layer;
        this.index = index;
    }
    undo() {
        if (this.index >= 0)
            this.group.insert_layer(this.layer, this.index);
        return null;
    }
    redo() {
        this.group.remove_layer(this.layer);
        return null;
    }
    dispose() {
        if (this.layer) {
            let layer = this.layer;
            if (layer.parent) {
                if (!layer.parent.layers.indexOf(layer)) {
                    layer.dispose();
                }
            } else {
                layer.dispose();
            }
        }
        this.layer = null;
    }
}

export class ReorderLayerUndo {
    constructor(layer, group, old_index, new_index) {
        this.group = group;
        this.layer = layer;
        this.old_index = old_index;
        this.new_index = new_index;
    }
    undo() {
        this.group.reorder_layer(this.layer, this.old_index);
        return null;
    }
    redo() {
        this.group.reorder_layer(this.layer, this.new_index);
        return null;
    }
    dispose() {
        if (this.layer) {
            let layer = this.layer;
            if (layer.parent) {
                if (!layer.parent.layers.indexOf(layer)) {
                    layer.dispose();
                }
            } else {
                layer.dispose();
            }
        }
        this.layer = null;
    }
}