
# 2.15.1

* Adds a method to `Dataset` called visit_full that returns a promise which iterates over all the tiles in the dataset including those that have not yet loaded. (Their load is triggered.)

# 2.15.0

This would be a bugfix release except that it's possible this might accidentally break code taking advantage of undocumented behavior involving the domain for categorical scales. If you've ever set a scale to have domain [-2047, 2047], the console will now throw a warning and autochange the extent to provide more sensible support for dictionary fields. 

- Fix off-by-one bug in color schemes affecting legend appearance for more than 2,048 categories.
  Because of variable rules around floating point precision, the number of categories you can display will vary
  depending on hardware implementations of the WebGL standard. But 10s of thousands should be fine.
- Many typing improvements for typescript compliance.
- Allow wrapping of dictionary colors in categorical scales.
- Stop internally representing dictionary scales on the range [-2047, 2047], which was confusing and not necessary.
- add a new scatterplot setter/getter method `highlit_point_change`. Like `click_handler`, `tooltip_html`, etc. Whatever function
  you place here will be called on the list of points that are currently highlighted (i.e., that have a svg circle over them). In
  all standard cases this list will be of length zero (there's no point under the cursor) or one (there's a point under
  the cursor that's bigger). This can be useful for calling events when--for example--the user switches to a no-highlighted 
  point state. In general I suspect that this could be superior to tooltip_html unless you're actually using the tooltip.
- Add an optional method `useNameCache` to `scatterplot.select_data`. This makes it easier for users to maintain their own 
  namespaces for selections. By default, attempting to create a new selection with 
  the same name as an existing selection raises an error, because having two selections with *different* rules but the same name
  could result in some crazy errors where different parts of the map rendered different rules. With a name cache, the first rule
  used will be the one that's kept, and the second will be ignored.
- add method `Selection.moveCursorToPoint(point)`. This allows a selection's cursor
  (the thing we use in Nomic Atlas to show a point on mouseover) to be fast-forwarded so that it's over a given point.
- The method `Scatterplot.select_and_plot()` used to return nothing;
  it now returns the selection that it creates. This could introduce typescript 
  errors into code.
# 2.14.1
- Add exports of QuadtileDataset, ArrowDataset, Bitmask, and DataSelection classes as static methods
  on core deepscatter object. In a future release, these may become named exports: for now 
  Scatterplot is staying the one and only export, as a default for back-compatabiility.
- Improve Bitmask class to include ANY and ALL compositors in selections, misc small fixes.
# 2.14.0
- Allow defining transformation functions by points, not just record batches, 
  so that you can define new functions without knowing the Apache Arrow spec front to back.
- Create new function at deepscatter.utils.createDictionaryWithVector for use inside transformations that 
  need to return a dictionary. This is unfortunately complicated, because utf-8 serialization and deserialization is an Arrow achilles heel. I've designed the function to be [curryable](https://en.wikipedia.org/wiki/Currying) so that an initial dictionary set can be used multiple times without incurring huge deserialization costs.
- Bump Arrow to 13.0.0
- Fix for bugs in domains.
- Update dataset methods to allow instantiating from an arrow table represented
  as a Uint8Array, which is simpler and avoids some conflicts in Apache Arrow versions.
- Allow creating a dataset in the constructor, before the initial
  plotAPI call,  which allows more
  precise staging of data and allows access to most dataset capabilities without binding to the DOM.
- Support for Arrow Boolean types in transformations/selections.
- New `Bitmask` type wrapping Boolean arrays on batches
- Support combining of multiple selections into new selection using
  fast `AND`, `OR`, `NOT`, and `XOR` operations.
- Avoid race condition in multiple calls to the same selector.
- Add applyToAllLoadedTiles method to selections.
# 2.13.3

Add `select_and_plot` shortcut on `Deepscatter` object to plot a selection immediately
on creation.
 
# 2.13.2

- Publish type definitions. at dist/deepscatter.d.ts
  and adjacent files.

# 2.13.0
- Introduce new 'selection' fundamental; selections allow
  managing a variety of common operations on sets of points,
  including iteration, creation of a column from a list of ids,
  and (WIP) unioning, intersection, and other operations on 
  arrow columns and bitmasks.
- More comprehensive type annotations
- Remove random jitter on point size above 5 pixels.
# 2.12.0

- Allow accessing dataset at `scatterplot.dataset`, rather than the confusing `scatterplot._root`.

# 2.11.0

- Support 'sidecar' tiles to allow lazy loading of certain columns.

# 2.10.0

- Fully supported 'between' as alternative to 'within' for filter operations.
- Allow passing labels through API directly.

# 2.9.2

- Fix bug in manually-assigned categorical color schemes involving the first color always being gray.

# 2.9.1

- Fix regression bug for log-scales on linear color schemes.

# 2.9.0

- Allow asynchronous transformations. This is an internal change that allows alteration of tiles using any external resources--for instance, fetching search results from the Web or running duckdb on wasm.
- Various changes resulting from that.
- Customizable options for foreground/background behavior passed to the API as 'background_options'.

# 2.8.0

- Add new 'foreground' aesthetic; when enabled, this moves points to the front of the screen and makes points behind it not clickable.
- Removed event listener that significantly slowed down map when clicking to drag locations.

# 2.7.0

- Revamp a number of bad choices in the 'point_size' and 'alpha' parameters so that the units better correspond to screen pixels (for size) and alpha (on a scale of 1 to 100.) This unfortunately will requiring tweaking existing maps.
- Add auto-generated documentation.
- Allow dragging of labels around the screen for editing label collections.
- Make labels by default filter the underlying data if the geojson property name is in the
- Allow/restore custom color schemes for categorical data.
- Improve behavior of scales for temporal fields. (Note--deepscatter supports only Arrow timestamp fields, not Date32, Datetime64, or any of the other date/time implementations in Arrow.)

# 2.6.1

- Fix bug causing multiple positions to sometimes place points in their previous location during mouseover events.

# 2.6.0

- Allow labeling of maps using externally loaded data.
- Remove webworkers to simplify code.
- Add preliminary methods for updating data in-place using dense vectors.

# 2.5.0

- Allow destruction of deepscatter objects, freeing up associated GPU memory.
- Allow multiple plots on the same page by assigning ids: https://github.com/CreatingData/deepscatter/pull/47.
- Improved Typing for Aesthetics and Transforms. https://github.com/CreatingData/deepscatter/pull/46
- Fixed bug on M1 macs for mouseover past the 4 millionth (actually, 2^22) point in a set. Now mouseover events draw to the hidden canvas **twice**: first identifying which tile the moused-over point is in, and then identifying the row number inside that tile. This new field consumes an additional buffer, leaving 14 rather than 15 channels free for aesthetics.
- Added new test case plotting several million integers in Z-curve order for debugging purposes.
- Safety fixes for concurrent plotting of points.
- Supports handling ranges on [x, y] dimensions.
- Change of license associated with Nomic move.

# 2.4.1

Attempted bundle fixes.

# 2.4.0

FEATURES:

Preliminary ability to pass an arrow table directly to Deepscatter without tiling it using quadfeather. Each record batch is treated as a tile, and every batch will be drawn in most draw passes; this works well for up to a few million points.

DESIGN:

Extensive refactor to allow 'datasets' to be drawn, which provide an abstraction between individual tiles and the full renderer. This is currentoy used to draw arrow tables; I may also allow it to use duckdb soon.

CODE QUALITY:

Thanks to Don Isaac, a number of improvements to linting and ts typing that should help increase code quality going forward.

# 2.3.2

FEATURES: Clarify and cleanup the API around `tooltip_html` and `click_function`. Now both can be _either_ by assigning a function to the base scatterplot object, or by passing a string that defines a function with an implied argument of `datum` to the JSON-based API.

BUGFIX: Fix problem breaking secondary filters.

CODE: Slightly simplify aesthetic code by removing 'label' attribute.

# 2.3.1

Publication fix

# 2.3.0

BREAKING API CHANGE: 'duration' argument is now in milliseconds, not seconds, for greater consistency with d3 tooling.

Create new class of "plot settings" for aesthetics scaled at the plot level rather than the point level. This allows smooth updates to overall point size, target alpha, etc.

"Shufbow" scheme uses deterministic order. [commit](https://github.com/CreatingData/deepscatter/commit/a54fad1fcc2650b6fe5d08823be26e286e0e2edd)

# 2.2.5

Support int32 dates as floats (without null mask for now.)

# 2.2.3

Use of 'x0' and 'y0' positions produce smooth interpolation between two different points.

# 2.2.2

Hopefully fix issue with points of index zero breaking display size rules.

# 2.2.0

Switch to Arrow JS 7.0 backend, requiring substantial rewrite.

# 2.1.1

Restore some jitter types broken by ts conversion.

Remove some extraneous logging.

# 2.1.0

1. Major refactor to use typescript. This requires standardizing some of the approaches to API a bit more, and
   likely will cause some short-term breakage until all changes are found. Most
   files renamed from `.js` to `.ts`. Not yet passing all typescript checks.

2. Shift texture strategy for lookups to minimize number of samplers; from 16 in the old version to two
   in the new one (one for one-d channels like filters, and the other for color schemes.) Introduces a new
   class in AestheticSet.ts.

3. Start to build an API independent of the `plotAPI`, especially using Andromeda Yelton's code to programatically
   control the function responses on mouseover and click events.

4. Some minor shifts in the shader code. I don't anticipate doing any more major webGL features, and instead am
   trying to prepare for a webGPU push that will be version 3.0.

5. Add UMD, IIFE, etc. modules builds.

# 2.0

Complete rewrite. Move from Canvas to WebGL and from csv tile storage to Apache Arrow.

# 1.0

First release.
