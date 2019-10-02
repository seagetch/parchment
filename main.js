var ffi = require('ffi-napi');
var ref = require('ref-napi');
var Struct = require('ref-struct');
var fs = require('fs');
var epoll = require('epoll').Epoll;

const electron = require('electron');
const { app, BrowserWindow, ipcMain } = require('electron')

function open_callback(path, flag, user_data) {
    var fd = fs.openSync(path, flag, 0o400);
    return fd < 0 ? -1 : fd;
};
function close_callback(fd, user_data) {
    fs.closeSync(fd);
}
var libinput_interface_type = Struct({
    'open_restricted': ffi.Function('int', ['string', 'int', 'pointer']),
     'close_restricted': ffi.Function('void', ['int', 'pointer'])
})
libinput_interface_ptr = ref.refType(libinput_interface_type);

libinput_type = ref.types.void;
libinput_ptr  = ref.refType(libinput_type);
libinput_event = ref.types.void;
libinput_event_ptr = ref.refType(libinput_event);

// FIXME: Absolute paths for library is required for my environment. Need to be resolved on-demand.
var libinput = ffi.Library('/usr/lib/x86_64-linux-gnu/libinput.so.10', {
    'libinput_path_create_context': [ libinput_ptr, [ libinput_ptr, 'pointer' ] ],
    'libinput_path_add_device': [ 'pointer', [ libinput_ptr, 'string' ] ],
    'libinput_path_remove_device': ['void', ['pointer']],
    'libinput_get_fd': ['int', [libinput_ptr]],
    'libinput_udev_assign_seat':['int', [libinput_ptr, 'string']],
    'libinput_dispatch': ['void', [libinput_ptr]],
    'libinput_next_event_type': ['int', [libinput_ptr]],
    'libinput_get_event': [libinput_event_ptr, [libinput_ptr]],
    'libinput_event_destroy':['void', [libinput_event_ptr]],
    'libinput_suspend': ['void', [libinput_ptr]],
    'libinput_resume': ['int', [libinput_ptr]],
    'libinput_unref':['void', [libinput_ptr]],
    'libinput_event_tablet_tool_get_x': ['double', ['pointer']],
    'libinput_event_tablet_tool_get_y': ['double', ['pointer']],
    'libinput_event_tablet_tool_get_pressure': ['double', ['pointer']],
    'libinput_event_tablet_tool_get_tilt_x': ['double', ['pointer']],
    'libinput_event_tablet_tool_get_tilt_y': ['double', ['pointer']],
    'libinput_event_tablet_tool_get_rotation': ['double', ['pointer']],
    'libinput_event_tablet_tool_get_x_transformed': ['double',['pointer', ref.types.uint32]],
    'libinput_event_tablet_tool_get_y_transformed': ['double',['pointer', ref.types.uint32]],
});

const LIBINPUT_EVENT_TABLET_TOOL_AXIS = 600;
const LIBINPUT_EVENT_TABLET_TOOL_PROXIMITY = 601;
const LIBINPUT_EVENT_TABLET_TOOL_TIP = 602;
const LIBINPUT_EVENT_TABLET_TOOL_BUTTON = 603;

var current_screen = null;
var current_channel = null;

function libinput_main() {
    libinput_interface = new libinput_interface_type();
    libinput_interface.open_restricted  = open_callback;
    libinput_interface.close_restricted = close_callback;

    var li = libinput.libinput_path_create_context(libinput_interface.ref(), null);

    // FIXME: target device should be dynamically determined in the future.
    libinput.libinput_path_add_device(li, '/dev/input/event3')
    libinput.libinput_udev_assign_seat(li, "seat0");

    var fd = libinput.libinput_get_fd(li);
    libinput.libinput_dispatch(li);
    var i = 0;
    var poller = new epoll((err, fd, events) => {
        var event_type = libinput.libinput_next_event_type(li);
        var event = libinput.libinput_get_event(li);
        if (!event) {
            libinput.libinput_unref(li);
            console.log("Ended")
            return;
        }
        // handle the event here
        switch (event_type) {
        case LIBINPUT_EVENT_TABLET_TOOL_AXIS:
        case LIBINPUT_EVENT_TABLET_TOOL_PROXIMITY:
        case LIBINPUT_EVENT_TABLET_TOOL_TIP:
        case LIBINPUT_EVENT_TABLET_TOOL_BUTTON: {
            var ev_tablet = {
                x: current_screen? libinput.libinput_event_tablet_tool_get_x_transformed(event, current_screen.bounds.width): -1,
                y: current_screen? libinput.libinput_event_tablet_tool_get_y_transformed(event, current_screen.bounds.height): -1,
                pressure: libinput.libinput_event_tablet_tool_get_pressure(event),
                tilt_x: libinput.libinput_event_tablet_tool_get_tilt_x(event),
                tilt_y: libinput.libinput_event_tablet_tool_get_tilt_y(event),
                rotation: libinput.libinput_event_tablet_tool_get_rotation(event),
            }
            if (current_channel)
                current_channel.reply("tablet-motion", ev_tablet)
            else
                console.log("Fatal: current_channel is NULL.")
        } break;
        case 0:
            break;
        default:
            console.log("Event:"+event_type)
            break;
        }
        libinput.libinput_event_destroy(event);
        i++;
        libinput.libinput_dispatch(li);
    });
    poller.add(fd, epoll.EPOLLIN);
}

app.on("ready", ()=>{
    var window = new BrowserWindow({
        width: 800, height: 600,
        webPreferences: {
            nodeIntegration: true
        }
    });
    window.loadFile("./src/render/index.html")
    window.on('closed', () => {
        current_channel = null;
        win = null;
    })
    window.setMenuBarVisibility(false);
    window.show();

    libinput_main();
    let winBounds = window.getBounds();
    current_screen = electron.screen.getDisplayNearestPoint({x: winBounds.x, y: winBounds.y})
});

ipcMain.on("start", (event)=>{
    console.log("got start event.")
    current_channel = event;
});