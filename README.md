# Infinitely zoomable scatterplots.

This is code for making scatterplots of indefinite resolution. There
are two pieces of code; one is a python script that builds a tiled
directory of files; the other is a javascript (ES6) library that
displays these points in the browser and loads new points as the user
zooms in to specific areas.

Ridiculously, you *must* use an old version of python (2.0) and a new
version of Javascript (ES6) because I'm too lazy to fix up the python
one, and because javascript build platforms wouold change several
times before I got the ES6 to transpile. I usually just run `import
scatterplot from 'deepscatter'` inside some other ES6 code.

A description of some of the technology is in
[Creating Data](http://creatingdata.us/techne/scatterplots/)

See examples:

* [US Street names, UMAP embedding of word2vec model, 30,000 points](http://creatingdata.us/etc/streets/)
* [Hathi Trust Library books, 13.8 million points](http://creatingdata.us/datasets/hathi-features/)
* [Hathi Trust fiction, 150,000 books](http://creatingdata.us/techne/bibliographies/)


# Creating tiles.

This uses a python script to create csv data tiles (typically of around 1,000 points apiece) that
are then served through javvascript.

```bash
python python/scatterTiler.py --file ~/projects/umap_underwood_scatter/out.tsv build/data/scatter/hathi/ -t 1000
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

## Missing pieces.

Almost all the code is there for indexes; this lets you zoom to any individual
word without knowing where it is. I just haven't re-implemented it lately.

```
scatterplot.zoom_to_id('foo')
```
