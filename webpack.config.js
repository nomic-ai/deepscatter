const path = require("path");
const WorkerPlugin = require('worker-plugin');

module.exports = {
  entry: {
    deepscatter: "./src/deepscatter.js",
    worker: "./src/tileworker.worker.js"
  },
  output: {
//    path: path.resolve(__dirname, "dist"),
      path: __dirname,
      library: 'deepScatter',
      libraryTarget: 'umd',
      filename: "[name].js"
  },
  plugins: [
     new WorkerPlugin()
  ],
  stats: "minimal",
  module: {
    rules: [
      {
       test: /\.(glsl|frag|vert)$/,
       exclude: /node_modules/,
       use: [
         'raw-loader',
         {
           loader: 'glslify-loader'
           options: {
             transform: [
               ['glslify-hex', { 'option-1': true, 'option-2': 42 }]
             ]
           }
         }
       ]
     }
    ]
  }
};
