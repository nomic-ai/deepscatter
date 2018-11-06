const path = require("path");

module.exports = {
  entry: "./src/deepscatter.js",
  output: {
      path: path.resolve(__dirname, "dist"),
      library: 'deepScatter',
      libraryTarget: 'umd',
      filename: "deepScatter.js"
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        loader: "babel-loader",
        exclude: /(node_modules)/
      }
    ]
  }
};
