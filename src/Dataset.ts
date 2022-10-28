// A Dataset manages the production and manipulation of *tiles*.

import { Tile, Rectangle, QuadTile, ArrowTile } from './tile';
import {
  range, min, max, bisectLeft,
} from 'd3-array';
import * as Comlink from 'comlink';

//@ts-ignore
import TileWorker from './tileworker.worker.js?worker&inline';

import { APICall } from './types';
import Scatterplot from './deepscatter';
import { Float32, makeVector, StructRowProxy, Table, Vector } from 'apache-arrow';
import { assert } from './util';
type Key = string;

export abstract class Dataset<T extends Tile> {
  abstract root_tile : T;
  public max_ix = -1;
  protected plot : Scatterplot;
  protected _tileworkers: TileWorker[] = [];
  abstract ready : Promise<void>;
  abstract get extent() : Rectangle;

  constructor(plot : Scatterplot) {
    this.plot = plot;
  }
  static from_quadfeather(url : string, prefs: APICall, plot: Scatterplot) : QuadtileSet {
    return new QuadtileSet(url, prefs, plot);
  }
  static from_arrow_table(table: Table, prefs: APICall, plot: Scatterplot) : ArrowDataset {
    return new ArrowDataset(table, prefs, plot);
  }
  abstract download_most_needed_tiles(bbox : Rectangle | undefined, max_ix: number, queue_length : number) : void;

  /**
   * Map a function against all tiles.
   * It is often useful simply to invoke Dataset.map(d => d) to 
   * get a list of all tiles in the dataset at any moment.
   * 
   * @param callback A function to apply to each tile.
   * @param after Whether to perform the function in bottom-up order
   * @returns A list of the results of the function in an order determined by 'after.'
   */
  
  map<U>(callback : (tile: T) => U, after = false) : U[] {
    const results : U[] = [];
    this.visit((d : T) => { results.push(callback(d)); }, after = after);
    return results;
  }

  /**
   * Invoke a function on all tiles in the dataset that have been downloaded.
   * The general architecture here is taken from the
   * d3 quadtree functions. That's why, for example, it doesn't
   * recurse.

   * @param callback The function to invoke on each tile.
   * @param after Whether to execute the visit in bottom-up order. Default false.
   * @param filter 
   */
  visit(callback: (tile: T) => void, after = false, filter : (t : T) => boolean = (x) => true) {
    // Visit all children with a callback function.

    const stack : T[] = [this.root_tile];
    const after_stack = [];
    let current;
    while (current = stack.shift()) {
      if (!after) {
        callback(current);
      } else {
        after_stack.push(current);
      }
      if (!filter(current)) {
        continue;
      }
      // Only create children for downloaded tiles.
      if (current.download_state == 'Complete') {        
        stack.push(...current.children);
      }
    }
    if (after) {
      while (current = after_stack.pop()) {
        callback(current);
      }
    }
  }

  /**
   * 
   * @param ix The index of the point to get.
   * @returns 
   */
  findPoint(ix : number) : StructRowProxy[] {
    const matches : StructRowProxy[] = [];
    this.visit((tile : T) => {
      if (!(tile.ready && tile.record_batch && tile.min_ix <= ix && tile.max_ix >= ix)) {
        return;
      }
      const mid = bisectLeft([...tile.record_batch.getChild('ix').data[0].values], ix);
      const val = tile.record_batch.get(mid);
      if (val.ix === ix) {
        matches.push(val);
      }
    });
    return matches;
  }

  get tileWorker() {
    const NUM_WORKERS = 4;
    if (this._tileworkers.length > 0) {
      // Apportion the workers randomly whener one is asked for.
      // Might be a way to have a promise queue that's a little more
      // orderly.
      this._tileworkers.unshift(this._tileworkers.pop());
      return this._tileworkers[0];
    }
    for (const {} of range(NUM_WORKERS)) {
      this._tileworkers.push(
        //          Comlink.wrap(new Worker(this.url + '/../worker.js')),
        Comlink.wrap(new TileWorker()),
      );
    }
    return this._tileworkers[0];
  }

}

export class ArrowDataset extends Dataset<ArrowTile> {

  constructor(table: Table, prefs: APICall, plot: Scatterplot) {
    super(plot);
    this.root_tile = new ArrowTile(table, this, 0, plot);
  }

  get extent() {
    return this.root_tile.extent;
  } 

  get ready() {
    return Promise.resolve();
  }

  download_most_needed_tiles(bbox: Rectangle | undefined, max_ix: number, queue_length: number): void {
    // Definitionally there.
    return undefined;
  }
}

export class QuadtileSet extends Dataset<QuadTile> {
  protected _tileWorkers : TileWorker[] = [];
  protected _download_queue : Set<Key> = new Set();
  root_tile : QuadTile;

  constructor(base_url : string, prefs: APICall, plot: Scatterplot) {
    super(plot);
    this.root_tile = new QuadTile(base_url, '0/0/0', null, this);
  }

  get ready() {
    return this.root_tile.download();
  }
  get extent() {
    return this.root_tile.extent;
  }

  download_most_needed_tiles(bbox : Rectangle | undefined, max_ix: number, queue_length = 4) {
    /*
      Browsing can spawn a  *lot* of download requests that persist on
      unneeded parts of the database. So the tile handles its own queue for dispatching
      downloads in case tiles have slipped from view while parents were requested.
    */

    const queue = this._download_queue;

    if (queue.size >= queue_length) {
      return;
    }

    const scores : [number, QuadTile, Rectangle][] = [];
    function callback (tile : QuadTile) {
      if (bbox === undefined) {
        // Just depth.
        return 1 / tile.codes[0];
      }
      if (tile.download_state === 'Unattempted') {
        const distance = check_overlap(tile, bbox);
        scores.push([distance, tile, bbox]);
      }
    }

    this.visit(
      callback,
    );

    scores.sort((a, b) => a[0] - b[0]);
    while (scores.length > 0 && queue.size < queue_length) {
      const upnext = scores.pop();
      if (upnext === undefined) {throw new Error('Ran out of tiles unexpectedly');}
      const [distance, tile, _] = upnext;
      if ((tile.min_ix && tile.min_ix > max_ix) || distance <= 0) {
        continue;
      }
      queue.add(tile.key);
      tile.download()
        .then(() => queue.delete(tile.key))
        .catch((error) => {
          console.warn('Error on', tile.key);
          queue.delete(tile.key);
          throw (error);
        });
    }
  }
}

function area(rect : Rectangle) {
  return (rect.x[1] - rect.x[0]) * (rect.y[1] - rect.y[0]);
}

function check_overlap(tile : Tile, bbox : Rectangle) : number {
  /* the area of Intersect(tile, bbox) expressed
     as a percentage of the area of bbox */
  const c : Rectangle = tile.extent;

  if (c.x[0] > bbox.x[1]
      || c.x[1] < bbox.x[0]
      || c.y[0] > bbox.y[1]
      || c.y[1] < bbox.y[0]
  ) {
    return 0;
  }

  const intersection : Rectangle = {
    x: [
      max([bbox.x[0], c.x[0]]),
      min([bbox.x[1], c.x[1]]),
    ],
    y: [
      max([bbox.y[0], c.y[0]]),
      min([bbox.y[1], c.y[1]]),
    ],
  };
  const { x, y } = intersection;
  let disqualify = 0;
  if (x[0] > x[1]) { disqualify -= 1; }
  if (y[0] > y[1]) { disqualify -= 2; }
  if (disqualify < 0) {
    return disqualify;
  }
  return area(intersection) / area(bbox);
}
