const fs = require('fs');

let _config = JSON.parse(fs.readFileSync('./config/libraries.json', 'utf8'));

export default _config;