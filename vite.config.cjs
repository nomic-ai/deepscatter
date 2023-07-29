const glslify = require('rollup-plugin-glslify');

export default {
  build: {
    target: 'es2019',
    minify: 'terser',
    lib: {
      entry: __dirname + '/src/deepscatter.ts',
      name: 'Deepscatter',
      formats: ['es', 'umd'],
    },
  },

  plugins: [
    glslify({ compress: false }), // for debugging
  ],
};


/* Our friend in Northern VA advises this to remove Arrow:

const glslify = require('rollup-plugin-glslify');

export default {
  build: {
    target: 'es2019',
    minify: 'terser',
    lib: {
      entry: __dirname + '/src/deepscatter.ts',
      name: 'Deepscatter',
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      external: ['apache-arrow'],
      output: {
        globals: {
          'apache-arrow': 'ApacheArrow'
        }
      }
    }
  },
  plugins: [
    glslify({ compress: false }),
  ],
};

*/