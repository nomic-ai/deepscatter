const fs = require('fs')
const csv = require('csv-parser')
const stringify = require('csv-stringify/lib/sync');

// The purpose of this is to write out a bunch of CSV files without
// requiring the entire set ever to be in memory.

// The CSV files may hold raw image data for thumbnails.
// Your memory **does** need to be able to hold a little data for each item.

// I haven't written many node programs, so there may be some weird things here.

const yargs = require('yargs');

const argv = yargs
      .usage('Usage: $0 <file> [options]')
      .command('$0 <file>', 'Tile a CSV file.', () => {}, (argv) => {
        main(argv)
      })
      .demandCommand()
      .option('max-files', {
        description: 'Maximum number of files to have open at any time',
        type: 'number',
        'default': 1024,
      })
      .option('tile-size', {
        'alias': 't',
        'default': 10000,
        description: 'The number of datapoints in each tile.',
        type: 'number',
      })
      .help()
      .alias('help', 'h')
      .argv;

async function main(argv) {
  const {tileSize, maxFiles, file} = argv;
  const limits = {
    x: [Infinity, -Infinity],
    y: [Infinity, -Infinity]
  }


  let field_names= []
  let n_items = 0
  function reset_limits(record) {
    if (field_names.length==0) {
      field_names = Object.keys(record).concat('ix')
    }
    let {x, y} = record;
    x = +x
    y = +y
    if (x < limits.x[0]) {limits.x[0] = x}
    // Better to do this as a rounded buffer, later.
    if (x > limits.x[1]) {limits.x[1] = x + 1/100000}
    if (y < limits.y[0]) {limits.y[0] = y}
    if (y > limits.y[1]) {limits.y[1] = y + 1/100000}
    n_items += 1
  }

  fs.createReadStream(file)
    .pipe(csv({
      separator: ','
    }))
    .on('data', reset_limits)
    .on('end', () => {
      const metadata = {
        'limits': [limits.x, limits.y],
        'tileSize': tileSize,
        'max_zoom': Math.floor(n_items/tileSize),
        'fields': field_names,
      }
      fs.writeFileSync("build/data_description.json", JSON.stringify(metadata))
      allocate_tiles({limits, field_names}, file, 0)
    })


  function allocate_tiles(metadata, starting_file, starting_zoom) {
    const stack = new DiskTileStack(metadata, starting_file, 0)
    stack.rewrite_input()
  }


  function DiskTileStack(metadata, starting_file, starting_zoom, round=0) {

    const that = {}

    that.metadata = metadata
    that.starting_file = starting_file
    that.starting_zoom = starting_zoom
    that.tile_set = new Map()
    that.ticker = 0
    that.open_files = 0
    that.round = round

    that.rewrite_input = () => {
      const {starting_file, add_datum, tile_set, flush, find_writable_file } = that;
      fs.createReadStream(starting_file)
        .pipe(csv({
          separator: ','
        }))
        .on('data', (d) => add_datum(d, that))
        .on('end', () => {
          console.log(`Completed ${starting_file} at depth ${that.round}`)
          const overfull = []
          for (const [k, v] of tile_set.entries()) {
            if (v.overflow) {
              overfull.push(k)
            }
            that.flush(v, true)
          }
          for (const tname of overfull) {
            const fname = `build/tiles/${tname}_overflow.csv`
            const [z, x, y] = tname.split("/").map(d => +d)
            const stack = DiskTileStack(metadata, fname, z + 1, that.round+1)
            stack.make_children(z, x, y)
            stack.rewrite_input()
          }
          if (that.starting_file.endsWith("_overflow.csv")) {
            fs.unlink(that.starting_file, function() {})
          }

        })
    }

    that.make_write = (key, overflow = false) => {
      const d = key.split("/").slice(0, 2).join("/")
      fs.mkdirSync(`build/tiles/${d}`, { recursive: true });
      let name = key
      if (overflow) {
        name = name + "_overflow"
      }
      that.open_files += 1
      const fout = fs.createWriteStream("build/tiles/" + name + ".csv", {flags:'w'})
      fout.write(stringify([that.metadata.field_names]))
      return fout
    }

    that.make_tile = function(z, x, y) {
      const key = [z,x,y].join("/")
      that.tile_set.set(key, {
        key: key,
        current_count: 0,
        data: [],
        closed: false,
        fout: that.make_write(key),
        overflow: false
      })
    }

    that.make_children = function(z, x, y) {
      for (const i of [0, 1]) {
        for (const j of [0, 1]) {
          that.make_tile(1 + z, i+x*2, j+y*2)
        }
      }
    }

    that.find_writable_file = (datum) => {

      // Given a datum with x and y values, find a file to write to.
      const { limits, metadata } = that.metadata;
      const { tile_set } = that;

      const xrat = (datum.x - limits.x[0])/(limits.x[1] - limits.x[0])
      const yrat = (datum.y - limits.y[0])/(limits.y[1] - limits.y[0])

      let overflow = false;
      let parent = undefined

      for (let k = that.starting_zoom; true; k += 1) {
        const zoom = 2**k
        const tilepos = [k, Math.floor(xrat*zoom), Math.floor(yrat*zoom)]
        const key = tilepos.join("/")
        let tile_data = that.tile_set.get(key)

        if (tile_data === undefined) {
          // How to handle a new item.

          // First, make sure we're allowed to open; if not,
          // return the parent.
          if ((that.open_files >= maxFiles)) {

            // reset the parent file to be a new overflow file.
            that.flush(parent, true)

            // Not really closed.
            parent.closed = false
            parent.overflow = true
            parent.fout = that.make_write(parent.key, true);
            tile_data = parent
          } else {
	    if (parent !== undefined) {
              const parenttile = parent.key.split("/").map(d => +d)
              // Make all the children together, so that overflow doesn't
              // get stuck.
              that.make_children(...parenttile)
	    } else {
	      that.make_tile(...tilepos)
	    }
            tile_data = that.tile_set.get(key)
            if (tile_data === undefined) {
              console.log("Failure to launch")
              console.log(that.tile_set.keys())
            }
          }
        }

        if (tile_data.current_count >= tileSize) {
          // If we're in overflow mode, immediately return it.
          if (tile_data.overflow) {
            return tile_data
          }
          else {
            if (!tile_data.closed) {
              that.flush(tile_data, close = true)
            }
            // Loop back to the start here.
            parent = tile_data
            continue
          }
        } else {
          return tile_data
        }
      }
    }

    that.add_datum = function(datum) {
      const { starting_zoom, find_writable_file } = that;
      that.ticker += 1
      const tile_data = find_writable_file(datum)
      const elems = Object.values(datum)
      if (starting_zoom == 0) {
        elems.push(that.ticker)
      } else {

      }
      tile_data.data.push(elems)
      tile_data.current_count += 1
      // Flush out periodically so these don't get too long.
      if (tile_data.data.length >= 250) {
        that.flush(tile_data, false)
      }
    }

    that.flush = function(tile_data, close = false) {
      if (tile_data.data.length > 0) {
        const v = stringify(tile_data.data)
        if (tile_data.closed != false) {
          console.log(tile_data.key, "already closed; shouldn't happen", tile_data.data.length, tile_data.closed)
        }
        tile_data.fout.write(v)
        tile_data.data = []
      }
      // Closing happens even when no more data need be writ.
      if (close) {
        that.open_files -= 1
        tile_data.closed = true
        tile_data.fout.end()
      }
    }

    if (starting_zoom == 0) {
      that.make_tile(0, 0, 0)
    }

    return that
  }


  // Not used.

  function ix_to_tile(ix) {
    let local = ix
    // Any 3/2/2 key can be described as an index. Saves memory.
    for (z = 0; true; z += 1) {
      if (local < (2**z)**2) {
        return [z, Math.floor(local/(2**z)), local % (2**z)]
      }
      local -= ((2**z)**2)
    }
  }

  function tile_to_ix(z, x, y) {
    let start = 0
    for (i = 0; i < z; i += 1) {
      start += (2**i)**2
    }
    return start + x * (2**z) + y
  }

}
