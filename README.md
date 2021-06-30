# Warning

This library is still unstable; dragons, and so on. I wouldn't really
recommend using it unless you clearly know why!

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

# Quick start

## Importing the module.

I've got an Observable notebook that shows how to use this. For now, it's private--write 
me if you want access.

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

## Your own data.

1. Create a CSV file that has columns called 'x' and 'y'. (Or a feather file that has columns `x`, `y`, and `ix`, where `ix` is display order).
3. Tile it:
  ```sh
  quadfeather --files tmp.csv --tile_size 50000 --destination public/tiles
  ```
3. Edit the file at `index.html` to use an encoding scheme that matches your data.

## Build the module

```sh
npm run build
```

will create an ES module at `dist/deepscatter.es.js` The mechanics of
importing this are very slightly different than `index.html`.

Note that this is an ESM module and so requires you to use `<script type="module">` in your code.
Don't worry! It's 2021, we're allowed to 
do this now! Snippet:

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
         "field": "
     }
   }
}

```

## Implemented aesthetics.

1. x
2. y
3. size
4. jitter_radius: size of jitter.
5. jitter_speed: Speed of jitter.
6. color (categorical or linear: color scales explicitly, or accepting any d3-color name.)
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



# Infinitely zoomable scatterplots.

This is code for making scatterplots of indefinite resolution. There
are two pieces of code; one is a script that builds a tiled
directory of files; the other is a javascript (ES6) library that
displays these points in the browser and loads new points as the user
zooms in to specific areas.


A description of some of the technology using the old Canvas API is at
[Creating Data](http://creatingdata.us/techne/scatterplots/). The new WebGL version
is much faster, but lacks some features there. (It also has features that don't exist there.)

See examples:

* [US Street names, UMAP embedding of word2vec model, 30,000 points](http://creatingdata.us/etc/streets/)
* [Hathi Trust Library books, 13.8 million points](http://creatingdata.us/datasets/hathi-features/)
* [Hathi Trust fiction, 150,000 books](http://creatingdata.us/techne/bibliographies/)


# Creating tiles.

This uses a python script to create csv data tiles (typically of around 1,000 - 50,000 points apiece) that are then served through javascript.

```bash
node src/tiler.js --tile-size 20000 data/1e5.csv

```

# API

This API description is incomplete. If you actually want to use this and can't figure it out,
file an issue.


## Object creation

Creation is a two-step process.

First, instantiate a handler that will build a canvas. This is a synchronous function.

```js
import Scatterplot from 'deepscatter';

scatterplot = Scatterplot(
  '.vizpanel', // selector for the div where a canvas will be created
  document.documentElement.clientWidth, // width of the canvas
  document.documentElement.clientHeight, // height of the canvas.
);

```

## Plot through API

Then, interface by calling the API with a series of objects. The first call currently
tends to require a lot of parameters--I give a verbose one below. The first argument is
the directory created by the python call.

This returns a `Promise` that will load all require files before resolving the plot. Although there are
*are* a number of methods attached to the scatterplot that can be called directly, things are
handled best if you only call this one method.

There's also a special method, `scatterplot.redraw()`, that can be called in an emergency.

Most of these options have defaults, see `index.html` for a reasonably comprehensive example.

### `filters` and `+filters`

The visualization maintains a list of 'filters' that prevent points from being plotted.

#### Functional filters.

By default, filters build a function that returns true or false.

Filters are instantiated as an object.  The keys are the names of the
filters (so that they can be deleted); the value is built into a function
by implicitly adding `datum => ` to the front.

So for example, in the following filter:

```
"filters": {
 "English": "datum.language=='English'",
 "Science": "datum.Classification=='Q'"
}
```

`Science` will be limited by the return value of the function
defined as `d => d.Classification=='Q'`.


#### Regex filters.

Removed--would this be useful?


# Other notes

There a few things for authoring that can only be done in the browser.

Especially important is the zoom level.

You can get a string telling you where are by typing into the console.

```js
scatterplot._renderer.current_corners()
```

