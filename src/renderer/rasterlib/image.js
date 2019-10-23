import UndoStack from './undo';
import LayerGroup from './layergroup';

export default class RasterImage extends LayerGroup {
    constructor(width, height) {
        super(0,0, width, height);
        this.undos  = new UndoStack(this, 3000);
    }
    dispose() {
        if (this.undos)
            this.undos.dispose();
        super.dispose();
    }
   set_visibility (value) {};
};