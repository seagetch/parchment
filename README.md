# Parchment

Electron-based painting software. (Currently testing technical feasibility to use electron as a base of graphics editing software.)

## Prerequisites
### Libraries
- Babl >= 0.1.44
- Gegl >= 0.3 (0.3 is recommended to work smoothly with libmypaint 1.3.0)
- libmypaint >= 1.3
- libinput (tested on 1.10.4)
   Read / write access must be permitted to /dev/input/event<N> (devices for tablet).
### Device access permission
you must be able to read /dev/input/event* files.
In ubuntu, easiest way is to add yourself to 'input' group.
```
sudo usermod -aG input <user name>
```

## Install
Run following commands on terminal.
```
git clone https://github.com/seagetch/parchment.git
cd parchment
npm install
npm run build-dep
npm run build
```

## Post Install
1. Updating library location file.
Configure `config/libraries.json`. Open file, and update the location for libraries listed at prerequisites section.
Below is the examples of tested environment.
```
{
    "libbabl": "/usr/local/lib/x86_64-linux-gnu/libbabl-0.1.so",
    "libgegl": "/usr/local/lib/x86_64-linux-gnu/libgegl-0.4.so",
    "libgobject": "/usr/lib/x86_64-linux-gnu/libgobject-2.0.so.0",
    "libmypaint": "/usr/local/lib/libmypaint-1.4.so.0",
    "libmypaint-gegl": "/usr/local/lib/libmypaint-gegl-1.4.so",
    "libinput": "/usr/lib/x86_64-linux-gnu/libinput.so.10",
    "libudev": "/lib/x86_64-linux-gnu/libudev.so.1"
}
```

## Run
```
npm run start
```
