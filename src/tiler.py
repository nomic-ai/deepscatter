import pyarrow as pa
from pyarrow import csv, feather
import pandas as pd
import logging
import shutil
from pathlib import Path

TILE_SIZE = 25000
MAX_RECORDS_IN_MEMORY = 1e7
FIN = "directories.csv"
TILE_PATH = "/Users/bschmidt/scrolly2/build/data/deepscatter/directories"

logging.getLogger().setLevel(logging.INFO)


# First, we guess at the schema using pyarrow's own type hints.

# This could be overridden by user args.

def determine_schema(filename):
    vals = csv.open_csv(filename,
                        csv.ReadOptions(block_size= 1024*1024*64),
                        convert_options = csv.ConvertOptions(
                            auto_dict_encode = True,
                            auto_dict_max_cardinality=512
                        ))

    schema = {}
    raw_schema = vals.read_next_batch().schema
    for el in raw_schema:
        t = el.type
        if t == pa.int64():
            t = pa.float32()
        if t == pa.float64():
            t = pa.float32()
        schema[el.name] = t

    return schema

schema = determine_schema(FIN)
# currently the dictionary type isn't supported while reading CSVs.
# So we have to do some monkey business to store it as keys at first, then convert to dictionary later.
schema_safe = dict([(k, v if not pa.types.is_dictionary(v) else pa.string())for k, v in schema.items()])

logging.info("Parsing with schema:")
logging.info(schema_safe)


# Next, convert these CSVs into some preliminary arrow files.
# These are the things that we'll actually read in.

# We write to arrow because we need a first pass anyway to determine
# the data bounds; and it will be much faster to re-parse
# everything from arrow than from CSV.

vals = csv.open_csv(FIN,
                        csv.ReadOptions(block_size= 1024*1024*128),
                        convert_options = csv.ConvertOptions(
                            column_types=schema_safe
                        ))

ix = 0
extent = {
    "x": [float("inf"), -float("inf")],
    "y": [float("inf"), -float("inf")],
}

if "z" in schema.keys():
    extent["z"] = [float("inf"), -float("inf")]

rewritten_files = []
for chunk_num, batch in enumerate(vals):
    # Loop through the whole CSV, writing out 100 MB at a time,
    # and converting each batch to dictionary as we go.
    d = dict()
    for i, name in enumerate(batch.schema.names):
        if pa.types.is_dictionary(schema[name]):
            d[name] = batch[i].dictionary_encode()
        else:
            d[name] = batch[i]
    data = pa.Table.from_batches([batch])
    # Count each element in an int32 array (float32 risks overflow.)
    d["ix"] = pa.array(range(ix, ix + len(batch)), type = pa.int32())
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
# Learn the schema from the last file written out.

raw_schema = final_table.schema



open_files = 0
max_tiles = MAX_RECORDS_IN_MEMORY / TILE_SIZE

records_in_memory = 0
tiles_open = 1


def partition(table, midpoint):
    # Divide a table in two based on a midpoint
    key, pivot = midpoint
    criterion = table[key] < pivot
    splitted = table[criterion], table[~criterion]
    return splitted

class Tile():
    # some prep to make OCT_TREE SAFE--METHODS that support only quads
    # listed as QUAD_ONLY
    def __init__(self, extent, coords = None, basedir = Path(TILE_PATH)):
        self.coords = coords
        self.extent = extent
        self.basedir = basedir

        # Wait to actually create the directories until needed.
        self._filename = None
        self._children = None
        self._overflow_buffer = None
        self.data = []
        self.n_data_points = 0

    def __repr__(self):
        return f"Tile:\nextent: {self.extent}\ncoordinates:{self.coords}"

    def midpoints(self):
        midpoints = []
        for k, lim in self.extent.items():
            params = []
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

    def flush(self):
        global tiles_open
        global records_in_memory
        if (len(self.data)):
            frame = pa.concat_tables(self.data)
            feather.write_feather(frame, self.filename, compression = None)
            self.data = None
            records_in_memory -= frame.shape[0]
            tiles_open -= 1

    def flush_children(self, all_tiles = False):
        def flush_where_needed(tile):
            if tile.data is not None and (all_tiles or tile.n_data_points == TILE_SIZE):
                tile.flush()
        _ = self.map_tiles(flush_where_needed)

    @property
    def overflow_buffer(self):
        if self._overflow_buffer:
            return self._overflow_buffer
        fname = self.filename.with_suffix(".overflow.arrow")
        if fname.exists():
            fname.unlink()
        self._overflow_buffer = pa.ipc.new_file(fname, raw_schema)
        return self._overflow_buffer

    def partition_to_children(self, table):
        # Coerce to a list
        frames = [table]
        for pivot_dim in self.midpoints():
            expanded = []
            for frame in frames:
                expanded += partition(frame, pivot_dim)
            frames = expanded
        return frames

    @property
    def children(self):
        global tiles_open

        # QUAD ONLY
        if self._children is not None:
            return self._children
        if tiles_open > (max_tiles - 3):
            self._children = False
            return False

        tiles_open += 4
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
                self._children.append(Tile(extent, coords, self.basedir))
        return self._children

    def map_tiles(self, function):
        # Apply a function to this tile and all children.
        output = [function(self)]
        if self._children:
            for child in self._children:
                output += child.map_tiles(function)
        return output

    def summary(self):
        return self.map_tiles(lambda x: (x.coords, x.n_data_points))

    def retry_overflown_buffers(self):
        # Reinsert from a node that has been closed to children.
        if self._overflow_buffer:

            logging.debug(f"Flushing overflow at {self}")
            # If there's an overflow buffer, _children will have been
            # banned.
            self._overflow_buffer.close()
            self._children = None
            fname = self.filename.with_suffix(".overflow.arrow")
            fin = pa.ipc.RecordBatchFileReader(open(fname, "rb"))

            for i in range(fin.num_record_batches):
                self.insert(fin.get_batch(i).to_pandas())
            fname.unlink()
            self._overflow_buffer = None
            self.flush_children(all_tiles = True)

        if self._children:
            for child in self._children:
                child.retry_overflown_buffers()

    def insert(self, pdframe):
        global records_in_memory
        insert_n_locally = TILE_SIZE - self.n_data_points
        if (insert_n_locally > 0):
            head = pdframe.iloc[:insert_n_locally,]
            if head.shape[0]:
                records_in_memory += head.shape[0]
                self.data.append(pa.table(head, raw_schema))
                self.n_data_points += head.shape[0]
            if self.n_data_points == TILE_SIZE:
                # We can flush when we hit the end.
                self.flush()
            tail = pdframe.iloc[insert_n_locally:,]
            if tail.shape[0] == 0:
                return
        else:
            tail = pdframe
        if self.children:
            # Creates self.children if it doesn't exist.
            # If we are overflown, self.children returns false.
            partitioning = self.partition_to_children(tail)
            for child_tile, subset in zip(self.children, partitioning):
                child_tile.insert(subset)
            return
        else:
            self.overflow_buffer.write_batch(
                pa.record_batch(tail, raw_schema)
            )

logging.info("Done with preliminary build")

tiler = Tile(extent, [0, 0, 0])

for arrow_block in rewritten_files:
    d = feather.read_feather(arrow_block)
    d = d[pd.notna(d['x'])]
    tiler.insert(d)

logging.info("Initial partition complete--proceeding to children.")

tiler.flush_children(all_tiles = True)
# Works recursively lower down.
tiler.retry_overflown_buffers()
