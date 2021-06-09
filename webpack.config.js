/* global __dirname, require, module */

const path = require("path");
const webpack = require('webpack');
const pkg = require('./package.json');
let libraryName = pkg.name;
let libraryObjName = 'deepscatter'; // name for window.MyModule via script tag loading

let plugins = [], outputFile;


module.exports = {
  entry: {
    deepscatter: __dirname + "/src/deepscatter.js",
    worker: __dirname + "/src/tileworker.worker.mjs"
  },
  output: {
    path: __dirname + "/dist",
    filename: "[name].js",
    library: 'deepscatter',
    libraryTarget: 'umd',
    umdNamedDefine: false // must be 'false' for m to be resolved in require([''], (m) => {});
  },
  devtool: 'source-map',

//  stats: "minimal",
  module: {
    rules: [
      {
       test: /\.(glsl|frag|vert)$/,
       exclude: /node_modules/,
       use: [
         'raw-loader',
         {
           loader: 'glslify-loader',
           options: {
             transform: [
               ['glslify-hex', { 'option-1': true, 'option-2': 42 }]
             ]
           }
         }
       ]
     },
     {
      test: /(\.jsx|\.js)$/,
      loader: 'babel-loader',
      exclude: /(node_modules|bower_components)/
    },
    {
      test: /\.worker\.(c|m)?js$/i,
      use: [
        {
          loader: "worker-loader",
        },
        {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env"],
          },
        },
      ],
    }
    ]
  },
  resolve: {
    modules: [path.resolve('./node_modules'), path.resolve('./src')],
    extensions: ['.json', '.js','.mjs']
  },
  plugins: plugins
};
