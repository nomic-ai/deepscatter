import glslify from 'rollup-plugin-glslify';
import worker from 'rollup-plugin-web-worker-loader';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/deepscatter.js'),
      name: 'deepscatter',
      formats: ['es', 'umd'],
    },
  },
  plugins: [
    glslify({ compress: false }),
    worker({
      targetPlatform: 'browser',
      pattern: /(.+)\?worker/,
      //      extensions: supportedExts,
      preserveSource: true, // somehow results in slightly smaller bundle
    }),
  ],
};
