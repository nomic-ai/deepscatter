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

## Demo Data.

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

1. Create a CSV file that has columns called 'x' and 'y'; e.g., 
2. Tile it:
  ```sh
  quadfeather --files tmp.csv --tile_size 50000 --destination public/tiles
  ```
3. Edit the file at `index.html` to use dimensions matching those in your data.

# Code and bundling notes

This is currently bundled with vite and rollup. There is/will be a further interaction layer on 
top of it, but the core plotting components are separate and should work as a standalone layer that supports 
plot requests via an API. This is still subject to change and is not yet documented.

The demo site at `index.html` in the vite build won't work in production because of slight differences in bundling.
For a site that should work using the ESM module bundle created by 'npx vite build', see `index_prod.html`.

Note that this is an ESM module and so requires you to use `<script type="module">` in your code. DOn't worry! It's 2021, we're allowed to 
do this now!

## Code strategy 

Any interaction logic that changes the API call directly does not belong in this library. The only
interaction code here is for zooming and interacting with points.

## Future codebase splits.

The plotting components and the tiling components are logically quite separate; I may break
the tiling strategy into a separate JS library called 'quadfeather'.

Apache Arrow would still be a necessary intermediate format, but it could be generated from CSV files
using, say, `arquero` or a WASM port of `DuckDB`.

# Aesthetic channels

## Implemented

1. x
2. y
3. size
4. jitter_radius: size of jitter.
5. jitter_speed: Speed of jitter.
6. color (categorical or linear: color scales explicitly, or accepting any d3-color name.)
7. `x0` (for animations; transitions between x0 and x)
8. `y0` (for animations; transitions between y0 and y)

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
feel free to file an issue.


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

Most of these options have defaults, but I'll give an extensive one because I don't have an example set up yet.

```js

scatterplot.plotAPI(
{
  "base_dir": "/data/scatter/streets",
  "colors": {"name":""}, // Required; what are the colors to be used?
  "lab": ["name"], // What fields can appear as labels?
  "point_opacity": 1, // Zero to one.
  "font": "Helvetica" // a font for text
  "label_field":"name" // The field to use as labels in the initial plot.
  "point_size": 1.2, // in pixels.
  "variable_point_size": true, // should points vary in size.
  "point_threshold": 8, /* Only plot points up to a zoom level of 8, relative to the
  current window zoom.*/
  "guides": ["legend", "label_legend", "filter_legend"], // Put selector guides onscreen. Requires Bootstrap css to be loaded or it'll sprawl across the screen.
  "label_threshold": 0.1, // Attempt to print labels for up to 10% of points.
  "variable_text_size": true, // Higher-indexed labels are bigger.
  "zoom": [1, 4.06330232428664, 0.050736521860849315], // What zoom level to start at.
  "scheme": "dark" // Light or dark background scheme.
  }
```

## Simple calls

* `base_dir`: A local path to find tiles and data description. Typically created with the python script.
* `colors`: A dict of fields that should populate a dropdown menu of colors.
* `lab`: A list of fields that might be used to label points.
* `point_size`: The size of individual points, in pixels.
* `keys`: A dictionary of supplemental files for fields that may have longer labels. This
allows the use of integer or text keys in the CSV files without repeating long string. Each element
in the dictionary is a key-value pair. For instance, `{"Subclassification": "LCC.txt"}` indicates that for display, the values in the field `Subclassification` will be matched against the first column in `LCC.txt`, and the second column returned. This file is a `tsv` file, but can end with `.txt`.
* `show_only_n_categories`: if there is a color filter in effect, show only the top n values. This can
ensure that colors are not re-used.
* `debug`: Whether to show the outlines of the tiles being used. If 'theoretical,' returns the outlines of notional tile depth; if 'actual', shows the recursively packed tiles that actually have to be loaded.

## Complex Calls

### `filters` and `+filters`

The visualization maintains a list of 'filters' that prevent points from being plotted.

#### Functional filters.

By default, filters build a function that returns true or false.

Filters are instantiated as an object.  The keys are the names of the
filters (so that they can be deleted); the value is built into a function
by implicitly adding `d => ` to the front.

So for example, in the following filter:

```
"filters": {
 "English": "d.language=='English'",
 "Science": "d.Classification=='Q'"
}
```

`Science` will be limited by the return value of the function
defined as `d => d.Classification=='Q'`.


#### Regex filters.

Regular expression filters use a special compact syntax. The key should be name of the field to
be edited, and the value should be a regular expression with teh

The following regex will limit to single letter classes for R, S, and T, and allow either Q or any two letter queries starting with Q.

```
    "Classification": "/^Q.?|R|S|T$/"
```



# Other notes

There a few things for authoring that can only be done in the browser.

Especially important is the zoom level.

You can get a string telling you where are by typing into the console.

```js
scatterplot.where_am_i()
```

# To do

## Indices by id.

Almost all the code is there for indexes, which can locate a point
that hasn't been loaded using an alphabetical list. This lets you zoom
to any individual word without knowing where it is. I just haven't
re-implemented it lately.

```
scatterplot.zoom_to_id('foo')
```

## WebGL

Probably this should (at least optionally) be in WebGL. It's nice to
be able to control the plotting directly on data in Canvas, which is
why I use it. Canvas is fine for navigation, but there might be visual
advantages to pushing up towards 100,000 or 500,000 points. Above
1,000,000 points, the problem starts to be not rendering but shipping
data to the browser.

## Images

It would be pretty easy to have this draw images to the canvas as well as text and points.
This could be useful for T-SNE exploration. That field is already fairly well served up to a few hundred thousand, so I haven't done it here.

## ES Module

This should be an ES6 module.

## Responsive size setting

Currently, you specify the point size and target zoom directly. This means that smaller
screens have much higher overplotting than bigger ones. For mobile devices, it would probably
be better to print some combination of fewer points and smaller points; how to balance those
two goals is unclear.
