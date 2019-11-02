const fs = require('fs');
const ffi = require('ffi-napi');
const ref = require('ref-napi');
const Struct = require('ref-struct-di')(ref);
const epoll = require('epoll').Epoll;
const EventEmitter = require("events");

import lib_config from '../resources/lib_config'

class LibInput {
    constructor() {
        this.LIBINPUT_EVENT_TABLET_TOOL_AXIS = 600;
        this.LIBINPUT_EVENT_TABLET_TOOL_PROXIMITY = 601;
        this.LIBINPUT_EVENT_TABLET_TOOL_TIP = 602;
        this.LIBINPUT_EVENT_TABLET_TOOL_BUTTON = 603;

        this.libinput_interface = Struct({
            'open_restricted': ffi.Function('int', ['string', 'int', 'pointer']),
            'close_restricted': ffi.Function('void', ['int', 'pointer'])
        });
        this.Plibinput_interface = ref.refType(this.libinput_interface);
        this.libinput_t = ref.types.void;
        this.Plibinput_t  = ref.refType(this.libinput_t);
        this.libinput_event = ref.types.void;
        this.Plibinput_event = ref.refType(this.libinput_event);
        Object.assign(this, ffi.Library(lib_config['libudev'], {
            'udev_new': ['pointer', []],
            'udev_ref': ['pointer', ['pointer']],
            'udev_unref': ['pointer', ['pointer']],
        }));

        Object.assign(this, ffi.Library(lib_config['libinput'], {
            'libinput_udev_create_context': [ this.Plibinput_t, [ this.Plibinput_interface, 'pointer', 'pointer' ] ],
            'libinput_path_create_context': [ this.Plibinput_t, [ this.Plibinput_interface, 'pointer' ] ],
            'libinput_path_add_device': [ 'pointer', [ this.Plibinput_t, 'string' ] ],
            'libinput_path_remove_device': ['void', ['pointer']],
            'libinput_get_fd': ['int', [this.Plibinput_t]],
            'libinput_udev_assign_seat':['int', [this.Plibinput_t, 'string']],
            'libinput_dispatch': ['void', [this.Plibinput_t]],
            'libinput_next_event_type': ['int', [this.Plibinput_t]],
            'libinput_get_event': [this.Plibinput_event, [this.Plibinput_t]],
            'libinput_event_destroy':['void', [this.Plibinput_event]],
            'libinput_suspend': ['void', [this.Plibinput_t]],
            'libinput_resume': ['int', [this.Plibinput_t]],
            'libinput_unref':['void', [this.Plibinput_t]],
            'libinput_event_tablet_tool_get_button':['int',['pointer']],
            'libinput_event_tablet_tool_get_x': ['double', ['pointer']],
            'libinput_event_tablet_tool_get_y': ['double', ['pointer']],
            'libinput_event_tablet_tool_get_pressure': ['double', ['pointer']],
            'libinput_event_tablet_tool_get_tilt_x': ['double', ['pointer']],
            'libinput_event_tablet_tool_get_tilt_y': ['double', ['pointer']],
            'libinput_event_tablet_tool_get_rotation': ['double', ['pointer']],
            'libinput_event_tablet_tool_get_x_transformed': ['double',['pointer', ref.types.uint32]],
            'libinput_event_tablet_tool_get_y_transformed': ['double',['pointer', ref.types.uint32]],
            'libinput_event_tablet_tool_get_time': ['uint32', ['pointer']]
        }));

        this.init();
    }

    init() {
        this.events = new EventEmitter();
        var open_callback = function(path, flag, user_data) {
            var fd = fs.openSync(path, flag, 0o400);
            return fd < 0 ? -1 : fd;
        };
        var close_callback = function(fd, user_data) {
            fs.closeSync(fd);
        }
        this.udev = this.udev_new();
        let libinput_interface = new this.libinput_interface();
        libinput_interface.open_restricted  = open_callback;
        libinput_interface.close_restricted = close_callback;
        this.li = this.libinput_udev_create_context(libinput_interface.ref(), null, this.udev);
        this.libinput_udev_assign_seat(this.li, "seat0");
    }

    dispose() {
        if (this.li) {
            this.libinput_unref(this.li);
            this.li = null;
        }
        if (this.udev) {
            this.udev_unref(this.udev);
            this.udev = null;
        }
    }

    suspend() {
//            console.log("do_suspend")
//            this.libinput_suspend(this.li);
//            console.log("done_suspend");
            this.suspended = true;
    }

    resume() {
//        if (this.li && this.suspended) {
//            console.log("do_resume")
//            this.libinput_resume(this.li);
//            console.log("done_resume");
            this.suspended = false;
//        }
    }

    watch() {
        var fd = this.libinput_get_fd(this.li);
        this.libinput_dispatch(this.li);
        var i = 0;
        var poller = new epoll((err, fd, events) => {
            while (true) {
                this.libinput_dispatch(this.li);
                var event_type = this.libinput_next_event_type(this.li);
                if (event_type == 0)
                    return;
                var event = this.libinput_get_event(this.li);
                if (this.suspended)
                    continue;
                // handle the event here
                switch (event_type) {
                case this.LIBINPUT_EVENT_TABLET_TOOL_AXIS:
                case this.LIBINPUT_EVENT_TABLET_TOOL_PROXIMITY:
                case this.LIBINPUT_EVENT_TABLET_TOOL_TIP: {
                    let ev_tablet = {
                        x: this.current_bounds? this.libinput_event_tablet_tool_get_x_transformed(event, this.current_bounds.width ) + this.current_bounds.x: -1,
                        y: this.current_bounds? this.libinput_event_tablet_tool_get_y_transformed(event, this.current_bounds.height) + this.current_bounds.y: -1,
                        pressure: this.libinput_event_tablet_tool_get_pressure(event),
                        tilt_x: this.libinput_event_tablet_tool_get_tilt_x(event),
                        tilt_y: this.libinput_event_tablet_tool_get_tilt_y(event),
                        rotation: this.libinput_event_tablet_tool_get_rotation(event),
                        time: this.libinput_event_tablet_tool_get_time(event)
                    }
                    this.events.emit("tablet", ev_tablet);
                } break;
                case this.LIBINPUT_EVENT_TABLET_TOOL_BUTTON:
                case 0:
                    break;
                default:
                    console.log("Event:"+event_type)
                    break;
                }
                this.libinput_event_destroy(event);
                i++;
            }   
        });
        poller.add(fd, epoll.EPOLLIN);
    }
};

['addListener', 'prependListener', 'prependOnceListner', 'removeListener', 'removeAllListeners', 'on', 'off', 'once'].forEach((name, i)=>{
    LibInput.prototype[name] = function(...args) {
        return this.events[name](...args);
    }
})


let libinput = new LibInput();
export default libinput;