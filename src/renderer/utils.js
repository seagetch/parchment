import "jquery";
import "process";

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

$.fn.dom_resize = function(callback) {
    for (let i = 0; i < this.length; i ++) {
        let self = this[i];
        let observer = new ResizeObserver((entries)=>{
            console.log("dom_resize")
            for (let e of entries) {
                callback($(e.target));
            }
        });
        observer.observe(self);
        self.observer = observer;
    }
    return this;
}

function ScrolledView(jQuery) {
    let update = (elem) => {
        jQuery(elem).each((i, e)=>{
            let scrollable = jQuery(e).find(".scrollable");
            let scroll_top = scrollable.scrollTop();
            let scroll_bottom = scrollable[0].scrollHeight - (scrollable.scrollTop() + scrollable[0].clientHeight);
            jQuery(e).find(".scroll-up").css({
                display: scroll_top == 0? "none": "block"
            });
            jQuery(e).find(".scroll-down").css({
                display: scroll_bottom <= 0? "none": "block"
            });
        });
    }

    let bind = (elem) => {
        jQuery(elem).each((i, e)=>{
            let scrollable = jQuery(e).find(".scrollable");
            
            let up_timer_id = null;
            let scroll_up = jQuery("<div><i class=\"fas fa-chevron-up fa-1x \"></i></div>").addClass("text-primary scroll-up text-center").appendTo(e);
            let scroll_down = jQuery("<div><i class=\"fas fa-chevron-down fa-1x \"></i></div>").addClass("text-primary scroll-down text-center").appendTo(e);
            scroll_up.on("mousedown", (ev)=>{
                let timer_handler = ()=>{
                    scrollable.scrollTop(scrollable.scrollTop() - 48);
                    up_timer_id = window.setTimeout(timer_handler, 80);
                }
                timer_handler();
            }).on("mouseup mouseleave", (ev) => {
                if (up_timer_id) {
                    window.clearTimeout(up_timer_id);
                    up_timer_id = null;
                }
            });
            let down_timer_id = null;
            scroll_down.on("mousedown", (ev)=>{
                let timer_handler = ()=>{
                    scrollable.scrollTop(scrollable.scrollTop() + 48);
                    down_timer_id = window.setTimeout(timer_handler, 80);
                }
                timer_handler();
            }).on("mouseup mouseleave", (ev)=>{
                if (down_timer_id) {
                    window.clearTimeout(down_timer_id);
                    down_timer_id = null;
                }
            });
            update(e);
        });
    }

    bind(jQuery(".scroller"));

    jQuery(".scroller .scrollable").on("scroll", (ev) =>{
        update(jQuery(ev.target).parent());
    }).on("overflowchanged", (ev) => {
        console.log("dom_overflow:"+ev);
        update(jQuery(ev.target).parent());
    });
    jQuery(".scroller").on("overflowchanged", (ev) => {
        console.log("dom_overflow:"+ev);
        update(jQuery(ev.target));
    });
}

function VerticalToolBar(jQuery) {
    let bind = (elem) => {
        elem.css({
            'position' : 'fixed',
            'top' : '50%',
            'margin-top' : function() {return -jQuery(this).outerHeight()/2}
        }).dom_resize((elem) => {
            console.log("resize")
            elem.css({
                'position' : 'fixed',
                'top' : '50%',
                'margin-top' : function() {return -elem.outerHeight()/2}
            })
        });
    }

    bind(jQuery('.vertical-tool-box'));
}

function HorizontalToolBar(jQuery) {
    let bind = (elem) => {
        elem.css({
            'position' : 'fixed',
            'left' : '50%',
            'margin-left' : function() {return -jQuery(this).outerWidth()/2}
        }).dom_resize((elem) => {
            elem.css({
                'position' : 'fixed',
                'left' : '50%',
                'margin-left' : function() {return -elem.outerWidth()/2}
            })
        });
    }

    bind(jQuery('.horizontal-tool-box'))
}

$(function() {
    VerticalToolBar($);
    HorizontalToolBar($);
    ScrolledView($);
});
