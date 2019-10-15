// webpack.config.js
const webpack = require("webpack");
const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = [
{
    mode: "development",
    entry: path.join(__dirname, "src", "main", "main.js"),
    output: {
        path: path.join(__dirname, "dist"),
        filename: "main.js"
    },
    target: "electron-main",
    module: {
        rules: [
            { test: /\.ts$/, exclude: /node_modules/, loader: 'ts-loader'},
            { test: /\.js$/, exclude: /node_modules/, loader: 'babel-loader'}
        ]
    },
    resolve: {
        extensions: ['.js', '.ts']
    },
    externals: [nodeExternals()]
},
{
    mode: "development",
    entry: path.join(__dirname, "src", "renderer", "index.js"),
    output: {
        path: path.join(__dirname, "dist"),
        filename: "index.js"
    },
    target: "electron-renderer",
    module: {
        rules: [
            { test: /\.ts$/, exclude: /node_modules/, loader: 'ts-loader', options: { appendTsSuffixTo: [/\.vue$/] }},
            { test: /\.js$/, exclude: /node_modules/, loader: 'babel-loader',},
			{ test: /\.css$/, use: [ "style-loader", "css-loader"] },
            { test: /\.vue$/, loader: 'vue-loader'}
        ]
    },
    resolve: {
        extensions: ['.js', '.ts']
    },
    externals: [nodeExternals({
        whitelist: [
            "bootstrap/dist/css/bootstrap.min.css", 
            "bootstrap", 
            "@fortawesome/fontawesome-free/js/fontawesome", 
            "@fortawesome/fontawesome-free/js/regular", 
            "@fortawesome/fontawesome-free/js/solid"
            ]      
    })]
}
];