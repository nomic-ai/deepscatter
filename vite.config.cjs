const glslify = require("rollup-plugin-glslify");
import { defineConfig } from "vite";

//import worker from 'rollup-plugin-web-worker-loader';

//import { fileURLToPath } from 'url';

//const __filename = fileURLToPath(import.meta.url);
//const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => ({
  server: {
    open:
      mode === "simple" ? "/index-simplest-way-to-start.html" : "/index.html",
  },
  build: {
    target: "es2019",
    minify: "terser",
    lib: {
      entry: __dirname + "/src/deepscatter.ts",
      name: "Deepscatter",
      formats: ["es"],
    },
  },

  plugins: [
    glslify({ compress: false }), // for debugging
    /*    worker({
      targetPlatform: 'browser',
      pattern: /(.+)\?worker.js/,
      //      extensions: supportedExts,
      preserveSource: true, // somehow results in slightly smaller bundle
    }), */
  ],
}));
