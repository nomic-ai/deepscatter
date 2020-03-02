const path = require("path");

module.exports = {
  entry: "./src/deepscatter.js",
  output: {
//    path: path.resolve(__dirname, "dist"),
      path: __dirname,    
      library: 'deepScatter',
      libraryTarget: 'umd',
      filename: "deepScatter.js"
  },
  module: {
    rules: [
/*      {
        test: /\.js$/,
        loaders: ["babel"],
        exclude: /(node_modules)/
      } */
    ]
  }
};
