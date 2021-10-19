# Warning

This library is still unstable, and the API shifts depending on what I'm currently interesting. Open to thoughts, conversations, issues and complaints, but don't
put this on top of something that can't fail or that needs to change!

# Deep Scatterplots for the Web

This is a WebGL library for displaying more points than are ordinarily possible over the web.

It's fast for two reasons:

1. All data is sent in the Apache Arrow `feather` format, in a 
   special quadtree format that makes it possible to only load 
   data as needed on zoom. Feather takes no time to load in JS
   once copied, and can be directly copied to the shaders.
2. Most rendering is done in custom layers using WebGL, with a 
   buffer management strategy handled by REGL. This means that 
   there are no unnecessary abstractions around points.
3. All grammar-of-graphics transforms are handled on the GPU,
   which allows for interpolated transitions with calculations 
   in parallel.

# Examples

* [1 million+ documents from arxiv.com](https://observablehq.com/@bmschmidt/arxiv) rendered inside an Observable notebook.
* [Every person in the 2010 and 2020 US Censuses](https://all-of-us.benschmidt.org) displayed in an interactive svelte-kit app.

# Quick start

## Importing the module.

See the [arxiv example above](https://observablehq.com/@bmschmidt/arxiv) to see some basic examples.

## Running locally.

First, install the companion tiling library, which is written in python, 
and generate a million points of test data in tiles of 50000 apiece.


```sh
python3 -m pip install git+https://github.com/bmschmidt/quadfeather
quadfeather-test-data 1_000_000
quadfeather --files tmp.csv --tile_size 50_000 --destination public/tiles
```

Then setup this library to run. It will start a local dev server.

```sh
npm i
npm run dev
```

If you go to localhost:3000, it should have an interactive scatterplot waiting.
This development site only works in Chrome, not Safari or Firefox, because uses ES6 module syntax inside the webworker. The distributed version of 
the module should work in all browsers, although the low float precision on iOs means it doesn't look ideal on iPads compared to Android tablets.

## Your own data.

1. Create a CSV file that has columns called 'x' and 'y'. (Or a feather file that has columns `x`, `y`, and `ix`, where `ix` is display order). Any other columns (categorical information, etc.) can be included as additional columns.
3. Tile it:
  ```sh
  quadfeather --files tmp.csv --tile_size 50000 --destination public/tiles
  ```
3. Edit the file at `index.html` to use an encoding scheme that matches your data. The API call describing the basic plot is at [lines 45-78 in the example code]( https://github.com/CreatingData/deepscatter/blob/master/index.html#L45-L78), and includes some aesthetic descriptions like [`{field : "class"}`](https://github.com/CreatingData/deepscatter/blob/master/index.html#L55) on various lines that refer to CSV columns that are likely *not* in your data. So if you have a field called `species`, for example, you might change `{field : "class"}` to `{field : "species"}`, and replace 
   ```
   "size": {
        "field": "quantity",
        "transform": "sqrt",
        "domain": [0, 3],
        "range": [0, 4]
   }
   ```
   with 
   ```
    "size": {
        "field": "species",
        "range": "category10"
     }
     ```
At some point soon I hope to share an easier way to create these specs that does not require coding JSON directly.


## Build the module

```sh
npm run build
```

will create an ES module at `dist/deepscatter.es.js` The mechanics of
importing this are very slightly different than `index.html`.

Note that this is an ESM module and so requires you to use `<script type="module">` in your code.
Don't worry! It's 2021, we're allowed to 
do this now! But do be aware that this will not work on computers running very old browsers.

Snippet:

```html
<div id="my-div"></div>
<script type="module">
import Scatterplot from './dist/deepscatter.umd.js'
f = new Scatterplot("#my-div")
</script>

```

 See `index_prod.html` for an example
 
This is currently bundled with vite and rollup. There is/will be a further interaction layer on 
top of it, but the core plotting components are separate and should work as a standalone layer that supports 
plot requests via an API. 



# Code strategy 

Any interaction logic that changes the API call directly does not belong in this library. The only
interaction code here is for zooming and interacting with points.

## Future codebase splits.

The plotting components and the tiling components are logically quite separate; I may break
the tiling strategy into a separate JS library called 'quadfeather'.

Apache Arrow would still be a necessary intermediate format, but it could be generated from CSV files
using, say, `arquero` or a WASM port of `DuckDB`.

# API

This is still subject to change and is not yet documented. The encoding portion of the 
API mimics Vega-Lite with some minor distinctions.

```js
{
   encoding: {
     "x": {
         "field": "x",
         "transform": "literal"
     },
     "color": {
         "field": "year",
         "range": "viridis",
         "domain": [1970, 2020]
   }
}

```

## Implemented aesthetics.

1. x
2. y
3. size
4. jitter_radius: size of jitter. API subject to change.
5. jitter_speed: speed of jitter. API subject to change.
6. color (categorical or linear: range can call color scales explicitly, or accepting any d3-color name.)
7. `x0` (for animations; transitions between x0 and x)
8. `y0` (for animations; transitions between y0 and y)
9. `filter`. (Filtering is treated as an aesthetic operation by this library.)

## Planned

1. Symbol (Mapping of categorical variables to single unicode points in a single font; probably 255 max.)
2. Label (Full-text label)
3. Image (Like PixPlot)

## Jitter

Jitter is a little overloaded with features right now, but some are quite fun.

# Principles

1. This is a 2d library.
2. The central zoom state is handled by d3-zoom.
3. That zoom state can be used to render to webgl. Don't know webgl? You
   should be able to use the zoom state to draw to canvas or svg layers using the
   same zoom and underlying data, so that you can draw point with webgl
   and then build a callout using d3-annotate.

