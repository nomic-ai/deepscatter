import pyarrow as pa
from pyarrow import csv, feather
import pyarrow.compute as pc
#import pandas as pd
import logging
import shutil
from pathlib import Path
import sys
import argparse
import json
from numpy import random as nprandom
from collections import defaultdict, Counter
from typing import DefaultDict, Dict, List, Tuple, Set
import numpy as np

logging.getLogger().setLevel(logging.INFO)

def parse_args():
    parser = argparse.ArgumentParser(description='Tile an input file into a large number of arrow files.')
    parser.add_argument('--first_tile_size', type=int, default = 1000, help ="Number of records in first tile.")

    parser.add_argument('--tile_size', type=int, default = 50000, help ="Number of records per tile.")
    parser.add_argument('--destination', '--directory', '-d', type=str, required = True, help = "Destination directory to write to.")
    parser.add_argument('--max_files', type=float, default = 200, help ="Max files to have open. Default 200; check ulimit -n to see what might be safe. But I've found that I can have many more than that, so... who knows.")
    parser.add_argument('--randomize', type=float, default = 0, help ="Uniform random noise to add to points. If you have millions of coincident points, can reduce the depth of teh tree greatly.")

    parser.add_argument('--files', "-f", nargs = "+",
                        type = str,
                        help="""Input file(s). If .csv, indexes will be assigned; if .arrow or .feather, assumed that 'ix' is present. Must be in sorted order.""")

    parser.add_argument('--limits', nargs = 4,
                        type = float,
                        metavar = list,
                        default = [float("inf"), float("inf"), -float("inf"), -float("inf")],
                        help="""Data limits, in [x0 y0 xmax ymax] order. If not entered, will be calculated.""")

    parser.add_argument('--dtypes', nargs = "*",
                        type = str,
                        metavar = list,
                        default = [],
                        help="datatypes, in 'key=value' format with no spaces. Eg --dtypes year=float64")

    parser.add_argument('--log-level',
        type = int,
        default = 30)

    args = parser.parse_args()
    logging.getLogger().setLevel(args.log_level)

    return args

# First, we guess at the schema using pyarrow's own type hints.

# This could be overridden by user args.

def refine_schema(schema : pa.Schema) -> Dict[str,pa.Schema]:
    fields = {}
    for el in schema:
        if isinstance(el.type, pa.DictionaryType) and pa.types.is_string(el.type.value_type):
            t = pa.dictionary(pa.int16(), pa.utf8())
            fields[el.name] = t
#            el = pa.field(el.name, t)
        elif pa.types.is_float64(el.type):
            fields[el.name] = pa.float32()
#            el = pa.field(el.name, pa.float32())
        elif el.name == "ix":
            fields[el.name] = pa.uint64()
        else:
            fields[el.name] = el.type
            #fields.append(el)
    return fields

def determine_schema(args):
    vals = csv.open_csv(args.files[0],
                        csv.ReadOptions(block_size= 1024*1024*64),
                        convert_options = csv.ConvertOptions(
                            auto_dict_encode = True,
                            auto_dict_max_cardinality=4096
                        ))
    override = {}
    for arg in args.dtypes:
        k, v = arg.split("=")
        override[k] = v

    raw_schema = vals.read_next_batch().schema

    schema = {}
    for el in raw_schema:
        t = el.type
        if t == pa.int64() and el.name != 'ix':
            t = pa.float32()
        if t == pa.int32() and el.name != 'ix':
            t = pa.float32()
        if t == pa.float64():
            t = pa.float32()
        if isinstance(t, pa.DictionaryType) and pa.types.is_string(t.value_type):
            t = pa.dictionary(pa.int16(), pa.utf8())
        schema[el.name] = t
        if el.name in override:
            schema[el.name] = getattr(pa, override[el.name])()

    schema_safe = dict([(k, v if not pa.types.is_dictionary(v) else pa.string())for k, v in schema.items()])
    return schema, schema_safe


# Next, convert these CSVs into some preliminary arrow files.
# These are the things that we'll actually read in.

# We write to arrow because we need a first pass anyway to determine
# the data bounds and some other stuff; and it will be much faster to re-parse
# everything from arrow than from CSV.

def rewrite_in_arrow_format(files, schema_safe, schema):
    # Returns: an extent and a list of feather files.

    ix = 0
    extent = {
        "x": [float("inf"), -float("inf")],
        "y": [float("inf"), -float("inf")],
    }

    if "z" in schema.keys():
        extent["z"] = [float("inf"), -float("inf")]

    rewritten_files = []
    for FIN in files:
        vals = csv.open_csv(FIN, csv.ReadOptions(block_size = 1024*1024*128),
                                convert_options = csv.ConvertOptions(
                                    column_types = schema_safe))
        for chunk_num, batch in enumerate(vals):
            logging.info(f"Batch no {chunk_num}")
            # Loop through the whole CSV, writing out 100 MB at a time,
            # and converting each batch to dictionary as we go.
            d = dict()
            for i, name in enumerate(batch.schema.names):
                if pa.types.is_dictionary(schema[name]):
                    d[name] = batch[i].dictionary_encode()
                else:
                    d[name] = batch[i]
            data = pa.Table.from_batches([batch])
            # Count each element in a uint64 array (float32 risks overflow,
            # Uint32 supports up to 2 billion or so, which is cutting it close for stars.)
            d["ix"] = pa.array(range(ix, ix + len(batch)), type = pa.uint64())
            ix += len(batch)
            for dim in extent.keys(): # ["x", "y", maybe "z"]
                col = data.column(dim)
                zoo = col.to_pandas().agg([min, max])
                extent[dim][0] = min(extent[dim][0], zoo['min'])
                extent[dim][1] = max(extent[dim][1], zoo['max'])
            final_table = pa.table(d)
            fname = f"{chunk_num}.feather"
            feather.write_feather(final_table, fname, compression = "zstd")
            rewritten_files.append(fname)
    raw_schema = final_table.schema
    return rewritten_files, extent, raw_schema
    # Learn the schema from the last file written out.

def check_filesnames(args):
    files = args.files
    ftypes = [f.split(".")[-1] for f in files]
    for f in ftypes:
        if f != f[0]:
            raise TypeError(f"Must pass all the same type of file as input, not {f}/{f[0]}")
    if not f in set(["arrow", "feather", "csv", "gz"]):
        raise TypeError("Must use files ending in 'feather', 'arrow', or '.csv'")

# Memory tiles *might* be flushed into overflow mode, so we count them.

# Start at one to count the initial tile. (This number is incremented when children are built.)
memory_tiles_open : Set[str] = set()
files_open : Set[str] = set()

# Will be overwritten from args


def main():
    args = parse_args()
    if (args.files[0].endswith(".csv") or args.files[0].endswith(".csv.gz")):
        schema, schema_safe = determine_schema(args)
        # currently the dictionary type isn't supported while reading CSVs.
        # So we have to do some monkey business to store it as keys at first, then convert to dictionary later.
        logging.info("Parsing with schema:")
        logging.info(schema)
        rewritten_files, extent, raw_schema = rewrite_in_arrow_format(args.files, schema_safe, schema)
        logging.info("Done with preliminary build")
    else:
        rewritten_files = args.files
        if args.limits[0] > 1e8:
            if len(args.files) > 1:
                logging.warn("Checking limits for bounding box but only on first passed file, i.e., " + args.files[0])
            xy = feather.read_table(args.files[0], columns=["x", "y"])
            x = pc.min_max(xy['x']).as_py()
            y = pc.min_max(xy['y']).as_py()
            extent = {
                "x": [x['min'], x['max']],
                "y": [y['min'], y['max']]
            }
        else:
            extent = {
                "x": [args.limits[0], args.limits[2]],
                "y": [args.limits[1], args.limits[3]]
            }

        logging.info("extent")
        logging.info(extent)
        raw_schema = pa.ipc.RecordBatchFileReader(args.files[0]).schema
        schema = refine_schema(raw_schema)
        raw_schema = pa.schema([pa.field(name, type) for name, type in schema.items()])

    tiler = Tile(extent, [0, 0, 0], args)

    logging.info("Starting.")

    count_holder = defaultdict(Counter)

    recoders = dict()

    for field in raw_schema:
        if (pa.types.is_dictionary(field.type)):
            recoders[field.name] = get_recoding_arrays(rewritten_files, field.name)

    for i, arrow_block in enumerate(rewritten_files):
        logging.info(f"Reading block {i} of {len(rewritten_files) - 1}")
        tab = feather.read_table(arrow_block)
        # tab = tab.filter(pc.invert(pc.is_null(tab['x'])))

        # Drop missing x values, silently
        d = dict()
        for t in tab.schema.names:
            if t in recoders:
                d[t] = remap_all_dicts(tab[t], *recoders[t])
            d[t] = tab[t]

        if args.randomize > 0:
            d['x'] = pc.add(d['x'], nprandom.normal(0, args.randomize, tab.shape[0]))
            d['y'] = pc.add(d['y'], nprandom.normal(0, args.randomize, tab.shape[0]))


        tab = pa.table(d)

        logging.info(f"{len(memory_tiles_open)} partially filled tiles buffered in memory and {len(files_open)} flushing overflow directly to disk.")
        remaining_tiles = args.max_files - len(memory_tiles_open) - len(files_open)
        logging.info(f"Inserting block {i} of {len(rewritten_files) - 1}")

        tiler.insert(tab, remaining_tiles)
        logging.info(f"Done inserting block {i} of {len(rewritten_files) - 1}")

#    final_dictionaries = make_final_dictionaries(count_holder)

    logging.info("Initial partition complete--proceeding to children.")

    # Flush all open tiles that are not overflown.
    tiler.map_tiles(lambda tile: tile.first_flush())

    # Works recursively lower down, including first flush for all newly created children.
    tiler.map_tiles(lambda tile: tile.retry_overflown_buffers(max_tiles = args.max_files))


    # Reflush every tile; starts at the root, moves out to the leaves.
    tiler.final_flush()

    count = 0
    flushed = 0

    for (coords, count_here, flushed_here) in tiler.summary():
        count += count_here
        flushed += flushed_here

    logging.info(f"{count} added, {flushed} flushed")
    logging.debug(memory_tiles_open)

def partition(table: pa.Table, midpoint: Tuple[str, float]) -> List[pa.Table]:
    # Divide a table in two based on a midpoint
    key, pivot = midpoint
    criterion = pc.less(table[key], np.float32(pivot))
    splitted = [pc.filter(table, criterion), pc.filter(table, pc.invert(criterion))]
    return splitted


class Tile():
    # some prep to make OCT_TREE SAFE--METHODS that support only quads
    # listed as QUAD_ONLY
    def __init__(self, extent, coords, args):
        global memory_tiles_open

        self.coords = coords
        self.extent = extent
        self.args = args
        self.basedir = args.destination
        self.first_tile_size = args.first_tile_size
        self.tile_size = args.tile_size
        self.schema = None

        # Wait to actually create the directories until needed.
        self._filename = None
        self._children = None
        self._overflow_buffer = None
        # Unwritten records for myself.
        self.data : List[pa.RecordBatch] = []
        # Unwritten records for my children.
        self.hold_for_children = []

        self.n_data_points = 0
        self.n_flushed = 0

        self.flush_status = "unflushed"
        memory_tiles_open.add(self.filename)


    def __repr__(self):
        return f"Tile:\nextent: {self.extent}\ncoordinates:{self.coords}"

    @property
    def TILE_SIZE(self):
        if self.coords[0] == 0:
            return self.args.first_tile_size
        else:
            return self.args.tile_size
    def midpoints(self) -> List[Tuple[str, float]]:
        midpoints : List[Tuple[str, float]] = []
        for k, lim in self.extent.items():
            # params = []
            midpoint = (lim[1] + lim[0])/2
            midpoints.append((k, midpoint))
        # Ensure x,y,z order--shouldn't be necessary.
        midpoints.sort()
        return midpoints

    @property
    def filename(self):
        if self._filename:
            return self._filename
        local_name = Path(*map(str, self.coords)).with_suffix(".feather")
        dest_file = Path(self.basedir) / local_name
        dest_file.parent.mkdir(parents=True, exist_ok=True)
        self._filename = dest_file
        return self._filename

    def first_flush(self):
        # Ensure this function is only ever called once.

        if self.flush_status == "needs metadata":
            return
        self.flush_status = "needs metadata"

        global memory_tiles_open

        if self.n_data_points == 0:
            memory_tiles_open.remove(self.filename)
            return
        destination = self.filename.with_suffix(".needs_metadata.feather")
        self.flush_data(destination, {}, "zstd", expect_table = False)
        memory_tiles_open.remove(self.filename)

    def final_flush(self) -> None:
        """
        At the end, we can see which tiles have children and append that
        to the metadata.
        """
        self.total_points = 0
        metadata = {
            "extent": json.dumps(self.extent),
        }

        if self._children is None:
            metadata["children"] = "[]"
        else:
            for child in self._children:
                child.final_flush()
                self.total_points += child.total_points
            populated_kids = [c.id for c in self._children if c.total_points > 0]
            metadata["children"] = json.dumps(populated_kids)

        unclean_path = self.filename.with_suffix(".needs_metadata.feather")


        try:
            self.data = feather.read_table(unclean_path)

        except FileNotFoundError:
            if self._children == None:
                return
            else:
                raise FileNotFoundError("Couldn't find file even though children exist.")
#        for batch in self.data:
#            self.total_points += batch.num_rows
        self.total_points += self.data.shape[0]
        metadata["total_points"] = str(self.total_points)
        schema = pa.schema(self.schema, metadata = metadata)
        self.flush_data(self.filename, metadata, "uncompressed", schema, expect_table = True)
        share = self.coords[1] / (2**self.coords[0])
        share_rep = int(share * 80)
        print(f"Final Flush: {'=' * share_rep}{'-'*(80-share_rep)} {self.coords}", end = "\r")
        unclean_path.unlink()

    def flush_data(self, destination, metadata, compression, schema = None, expect_table = False):
        if self.data is None:
            return

        if expect_table:
            frame = self.data.replace_schema_metadata(metadata)
        else:
            if schema is None:
                schema = self.schema
            schema_copy = pa.schema(self.data[0].schema, metadata = metadata)
            frame = pa.Table.from_batches(self.data, schema_copy).combine_chunks()

        feather.write_feather(frame, destination, compression = compression)
        self.data = None

    @property
    def overflow_buffer(self):
        global files_open
        if self._overflow_buffer:
            return self._overflow_buffer
        logging.debug(f"Opening overflow on {self.coords}")

        fname = self.filename.with_suffix(".overflow.arrow")
        if fname.exists():
            fname.unlink()
        self._overflow_buffer = pa.ipc.new_file(fname, self.schema)
        files_open.add(fname)
        return self._overflow_buffer

    def partition_to_children(self, table) -> List[pa.Table]:
        # Coerce to a list in quadtree/octree order.
        frames = [table]
        pivot_dim : Tuple[str, float]
        for pivot_dim in self.midpoints():
            expanded = []
            for frame in frames:
                expanded += partition(frame, pivot_dim)
            frames = expanded
        return frames


    def last_check(self):
        logging.info(f"Finishing: flushed {self.total_points}")

    @property
    def children(self):
        if self._children is not None:
            return self._children

        return self.make_children()

    def make_children(self):
        # QUAD ONLY

        global memory_tiles_open
        # Calling this forces child creation even when it's not wise.
        self._children = []
        midpoints = self.midpoints()

        for i in [0, 1]:
            xlim = [midpoints[0][1], self.extent['x'][i]]
            xlim.sort()
            for j in [0, 1]:
                ylim = [midpoints[1][1], self.extent['y'][j]]
                ylim.sort()
                extent = {"x": xlim, "y": ylim}
                coords = self.coords[0] + 1, self.coords[1]*2 + i, self.coords[2]*2 + j
                child = Tile(extent, coords, self.args)
                self._children.append(child)
        return self._children

    def map_tiles(self, function):
        # Apply a function to this tile and all children.
        output = [function(self)]
        if self._children:
            for child in self._children:
                output += child.map_tiles(function)
        return output

    @property
    def id(self):
        return "/".join(map(str,self.coords))

    def summary(self):
        return self.map_tiles(lambda x: (x.coords, x.total_points, x.n_flushed))

    def close_overflow_buffers(self):
        # Close all open overflow buffers.
        global files_open
        if self._overflow_buffer:
            if self.filename.with_suffix(".overflow.arrow") in files_open:
                self._overflow_buffer.close()
                files_open.remove(self.filename.with_suffix(".overflow.arrow"))

        if self._children:
            for child in self._children:
                child.close_overflow_buffers()



    def retry_overflown_buffers(self, max_tiles = 1024):
        # Find all overflown buffers and flush them out.
        # Recursive.

        # Reinsert from a node that has been closed to children.
        if self._overflow_buffer:
            self.close_overflow_buffers()
            # If there's an overflow buffer, _children will have been
            # banned.
            self._children = []
            fname = self.filename.with_suffix(".overflow.arrow")
            fin = pa.ipc.RecordBatchFileReader(open(fname, "rb"))

            # Force child creation, even if we've got a few too many open right now.

            tile_budget = max_tiles - len(memory_tiles_open) - len(files_open)
            if tile_budget < 4:
                logging.warning(f"Warning--overriding tile budget on {self.coords} to force child creation.")
                tile_budget = 4
            self.make_children()

            logging.debug(f"Flushing {fin.num_record_batches} batches from {self.coords} with budget of {tile_budget} ({len(files_open)} memory, {len(memory_tiles_open)} tiles waiting to flush in memory)")

            for i in range(fin.num_record_batches):
                self.insert(pa.Table.from_batches([fin.get_batch(i)]), tile_budget)
            fname.unlink()
            self._overflow_buffer = None
            # Now we're writing to this tile again.
            self.map_tiles(lambda tile: tile.first_flush())

    def check_schema(self, table):
        if (self.schema is None):
            self.schema = table.schema
            return
        if not self.schema.equals(table.schema):
            raise TypeError("Attempted to insert a table with a different schema.")

    def insert(self, table, tile_budget = float("Inf")):
        self.check_schema(table)
        #logging.debug(f"Inserting to {self.coords} with budget of {tile_budget}")
        insert_n_locally = self.TILE_SIZE - self.n_data_points
        if (insert_n_locally > 0):
            local_mask = np.zeros((table.shape[0]), bool)
            local_mask[:insert_n_locally] = True
            head = pc.filter(table, local_mask)
            if head.shape[0]:
                for batch in head.to_batches():
                    self.data.append(batch)
                self.n_data_points += head.shape[0]
            table = table.filter(pc.invert(local_mask))
        else:
            pass

        children_per_tile = 2**(len(self.coords) - 1)
        if tile_budget >= children_per_tile or self._children is not None:
            # If we can afford to create children, do so.
            total_records = table.shape[0]
            if total_records == 0:
                return
            partitioning = self.partition_to_children(table)
            tiles_allowed_overflow = 0
            # The next block creates children and uses up some of the budget:
            # This one accounts for it.

            if self._children is None:
                tile_budget -= children_per_tile
                self.make_children()

            for child_tile, subset in zip(self.children, partitioning):
                # Each child gets a number of children proportional to its data share.
                # This works well on highly clumpy data.
                # Rebalance from (say) [3, 3, 3, 3]
                # to [0, 4, 4, 4] since anything less than four will lead to no kids.
                tiles_allowed = tile_budget * (subset.shape[0] / total_records) + tiles_allowed_overflow
                tiles_allowed_overflow = tiles_allowed % children_per_tile

                child_tile.insert(subset, tiles_allowed - tiles_allowed_overflow)
            if insert_n_locally > 0 and self.n_data_points == self.TILE_SIZE:
                # We've only just completed. Flush.
                self.first_flush()
            return
        else:
            for batch in table.to_batches():
                self.overflow_buffer.write_batch(
                    batch
                )
def get_better_codes(col, counter = Counter()):
    for a in pc.value_counts(col):
        counter[a['values'].as_py()] += a['counts'].as_py()
    return counter

def get_recoding_arrays(files, col_name):
    countered = Counter()
    for file in files:
        col = pa.feather.read_table(file, columns=[col_name])[col_name]
        countered = get_better_codes(col, countered)
    new_order = [pair[0] if pair[0] else "<NA>" for pair in countered.most_common(4094)]
    if len(new_order) == 4094:
        new_order.append("<Other>")
    new_order_dict = dict(zip(new_order, range(len(new_order))))
    return new_order, new_order_dict

def remap_dictionary(chunk, new_order_dict, new_order):
    # Switch a dictionary to use a pre-assigned set of keys. returns a new chunked dictionary array.
    index_map = pa.array([new_order_dict[str(k)] if str(k) in new_order_dict else len(new_order_dict) - 1 for k in chunk.dictionary], pa.uint16())
    if chunk.indices.null_count > 0:
        try:
            new_indices = pc.fill_null(pc.take(index_map, chunk.indices), new_order_dict["<NA>"])
        except KeyError:
            new_indices = pc.fill_null(pc.take(index_map, chunk.indices), new_order_dict["<Other>"])
    else:
        new_indices = pc.take(index_map, chunk.indices)

    return pa.DictionaryArray.from_arrays(new_indices, new_order)

def remap_all_dicts(col, new_order, new_order_dict):
    if (isinstance(col, pa.ChunkedArray)):
        return pa.chunked_array(remap_dictionary(chunk, new_order_dict, new_order) for chunk in col.chunks)
    else:
        return remap_dictionary(col, new_order_dict, new_order)
if __name__=="__main__":
    main()
