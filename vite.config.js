import glslify from 'rollup-plugin-glslify';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  build: {
    target: "esnext",
    lib: {
      entry: path.resolve(__dirname, 'src/deepscatter.js'),
      name: 'Deepscatter',
      formats: ['es', 'umd'],
    },
  },
  plugins: [
    glslify({ compress: false }),
/*    worker({
      targetPlatform: 'browser',
      pattern: /(.+)\?worker/,
      //      extensions: supportedExts,
      preserveSource: true, // somehow results in slightly smaller bundle
    }), */
  ], 
};
