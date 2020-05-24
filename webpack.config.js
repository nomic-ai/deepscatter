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

  module: {
/*   rules: [  {
        test: /\.js$/,
        loaders: ["babel"],
        exclude: /(node_modules)/
      } */
//    ]
  }
};
