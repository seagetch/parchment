class UndoStack {
    constructor(image, max_depth) {
        this.stack = new Array();
        this.reverse_stack = new Array();
        this.max_depth = max_depth;
        this.image = image;
    }

    dispose() {
        for (let i = 0; i < this.reverse_stack.length; i ++) {
            let freed = this.reverse_stack[i];
            freed.dispose();
        }
        this.reverse_stack.length = 0;
        for (let i = 0; i < this.stack.length; i ++) {
            let freed = this.stack[i];
            freed.dispose();
        }
        this.stack.length = 0;
    }

    push(undo) {
        for (let i = 0; i < this.reverse_stack.length; i ++) {
            let freed = this.reverse_stack[i];
            freed.dispose();
        }
        this.reverse_stack.length = 0;
        this.stack.push(undo);
        if (this.stack.length > this.max_depth) {
            let freed = this.stack.shift();
            freed.dispose();
        }
    }

    undo() {
        if (this.stack.length > 0) {
            let result = this.stack.pop();
            result.undo();
            this.reverse_stack.push(result);
        }
    }

    redo() {
        if (this.reverse_stack.length > 0) {
            let redoing = this.reverse_stack.pop();
            redoing.redo();
            this.stack.push(redoing);
        }
    }
}
module.exports = UndoStack;