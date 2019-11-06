export class StopWatch {
    constructor(sections) {
        this.counts = new Array(sections);
        this.start = new Array(sections);
        this.total = new Array(sections);
        this.id = 0;
        this.clear();
    }

    start_watch(id) {
        this.id = id;
        this.start[this.id] = process.hrtime.bigint();
    }
    lap(id) {
        let time = process.hrtime.bigint();
        this.total[id] += time - this.start[this.id];
        this.counts[id]++;
        this.start[id] = time
        this.id = id;
    }
    stop(id) {
        this.lap(id);
    }
    show() {
        for (let c = 0; c <= this.id; c++) {
            console.log(c+":"+ this.counts[c]+"/ avg "+(this.counts[c]? parseFloat(this.total[c]) / 1000.0 / 1000.0 / this.counts[c]: 0).toFixed(2)+"msec")
        }
    }
    clear() {
        for (let c = 0; c < this.counts.length; c++) {
            this.counts[c] = 0;
            this.start[c] = BigInt(0);
            this.total[c] = BigInt(0);
        }
    }
}
//var watch = new StopWatch(10);
