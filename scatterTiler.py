import json
import random
import math
import os
from argparse import ArgumentParser
import logging
import shutil
import logging
import sys
import gzip
import csv


def get_bounds(lines):
    """
    Learn the extent of a lines object. Needs to be done before tiling.
    Should probably be a class method.
    """
    xin = lines.headers.index('x')
    yin = lines.headers.index('y')

    xlim = [float("inf"),float("-inf")]
    ylim = [float("inf"),float("-inf")]    
    # The first line is column names
    n_errors = 0
    for i, line in enumerate(lines):
        try:
            x, y = map(float, [line[xin], line[yin]])
        except:
            n_errors += 1
            if n_errors in [1, 10, 100, 1000, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9]:
                print("{} errors".format(n_errors))
        if x < xlim[0]: xlim[0] = x
        if y < ylim[0]: ylim[0] = y
        if x > xlim[1]: xlim[1] = x
        if y > ylim[1]: ylim[1] = y
    print ("{} lines parsed".format(i))
    
    xrange = (xlim[1] - xlim[0]) *.05
    yrange = (ylim[1] - ylim[0]) *.05

    
    return ([xlim[0]-xrange,xlim[1] + xrange],[ylim[0]-yrange,ylim[1]+yrange])

def rescale(value,lims,modulo):
    # Gives the cell for a value
    # out in a grid of length modulo
    range = lims[1]-lims[0]
    this_val = value-lims[0]
    returnable = int(modulo*(this_val/float(range)))
    if returnable >= modulo:
        returnable = modulo-1
    if returnable < 0:
        returnable = 0
    return returnable

class Datatiler(object):
    def __init__(self, max, x, y, z, xlim, ylim, headers = ["x","y","id"], dir = "./", parent = None):
        self.max = max
        self.x = x
        self.y = y
        self.z = z
        
        self.xlim = xlim
        self.ylim = ylim
        self.mid_x = (xlim[0] + xlim[1])/2
        self.mid_y = (ylim[0] + ylim[1])/2
        self.headers = headers
        
        self.data = []
        self.already_written = 0
        self.counts = dict()
        self.files = dict()
        
        self.dir = dir

        self.parent = parent
        self.open_files = 0
        self.file = None
        self.children = dict()
        
        self.open_files = None
        self.stack_size = None        

    def build_children(self):
        xlim = self.xlim
        ylim = self.ylim
        
        xlim = [xlim[0], self.mid_x, xlim[1]]
        ylim = [ylim[0], self.mid_y, ylim[1]]
        
        for h in (0, 1):
            for v in (0, 1):
                lim_x = [xlim[0+h], xlim[1+h]]
                lim_y = [ylim[0+v], ylim[1+v]]
                
                tile = Datatiler(self.max,
                             self.x*2+h,
                             self.y*2+v,
                             self.z*2,
                             lim_x,
                             lim_y,
                             self.headers,
                             self.dir, parent = self)
                self.children[(h, v)] = tile

    def insert_to_children(self, point, xy):
        px, py = xy
        grid_x, grid_y = [0, 0]
        if px > self.mid_x:
            grid_x = 1
        if py > self.mid_y:
            grid_y = 1
        try:
            self.children[(grid_x, grid_y)].insert(point, xy)
        except KeyError:
            self.build_children()
            self.children[(grid_x, grid_y)].insert(point, xy)
        
    def return_file(self):
        x = self.x
        y = self.y
        z = self.z
        if self.file is not None:
            return self.file
        dir = "/".join(map(str,[self.dir, "tiles", z, x]))
        
        filename = "{}/{}.tsv".format(dir, y)
        if os.path.exists(filename):
            # When already created, reopen the existing file
            self.file = open(filename,"ab")
            return self.file
        else :
            if not os.path.exists(dir):
                os.makedirs(dir)
            self.file = open(filename, "wb")
            # Write the headers
            self.file.write("\t".join(self.headers) + "\r\n")
        
        return self.file

    def close_file(self):
        if self.file is not None:
            self.file.close()
            self.file = None

    def close_children(self):
        for k, child in self.children.iteritems():
            child.close_children()
        self.close_file()

    def n_open_files(self):
        # How many open file objects are there?
        # If it's a lot, we may need to clean.

        if self.open_files is not None:
            return self.open_files
        
        n = 0
        
        for k, child in self.children.items():
            n += child.n_open_files()
        self.open_files = n
        return n

    def n_stacked_items(self):
        if self.stack_size is not None:
            return self.stack_size
        
        n = len(self.data)
        for k, child in self.children.items():
            n += child.n_stacked_items()
        self.stack_size = n
        return n

    def flush_from_root(self):
        if self.parent is None:
            self.flush_all()
        else:
            self.parent.flush_from_root()
            
    def flush(self):
        try:
            file = self.return_file()
        except IOError as e:
            if "Errno 24" in str(e):
                # If it's full, close all the files and try again.
                # Won't work on the root; but that should never
                # fail to return a file.
                print("Too many files open... Attempting to recover")
                self.parent.flush_files_above_size(0)
                self.flush()
            else:
                raise
        rows = self.data
        writer = csv.writer(file, delimiter='\t')
        for row in rows:
            writer.writerow(map(str, row))
#            file.write("\t".join(map(str, row)) + "\n")
        self.already_written += len(rows)
        # Close the file. If more data needed, will be opened to append.
        self.file.close()
        self.file = None
        self.data = []

    def reset_counts_above(self):
        self.open_files = None
        self.stack_size = None
        if self.parent is not None:
            self.parent.reset_counts_above()

    def flush_files_above_size(self, size):
        if len(self.data) > size:
            self.flush()
            self.reset_counts_above()
            
        for k, child in self.children.items():
            child.flush_files_above_size(size)
            
    def flush_all(self):
        self.flush()
        for k, child in self.children.items():
            child.flush_all()
        
    def insert(self, point, xy = None):
        """
        Point can be an object of any length.
        This returns the current datatiler object; but if the insertion pushes the 
        object over the threshold,
        it returns a new finer grained one.
        """

        # Counts will need to be redone since the tree is descended here.
        self.open_files = None
        self.stack_size = None


        try:
            self.points_contained += 1
        except:
            self.points_contained = 1
        
        # Hopefully this lookup isn't expensive: repeating a gazillion times.
        if xy == None:
            xin = self.headers.index("x")
            yin = self.headers.index("y")

            # Cast string to float for x and y.
            try:
                x = float(point[xin])
                y = float(point[yin])
            except:
                print(len(point))
                print(point, xin)
                raise
        else:
            [x, y] = xy

        if self.already_written >= self.max:
            return self.insert_to_children(point, [x, y])

        self.data.append(point)
        
        if len(self.data) + self.already_written >= self.max:
            # Close the file when it's closed.
            self.flush()
            self.close_file()

        return (self.x, self.y, self.z)

class Indexer(object):
    def __init__(self, id_list, target_size = 2500, max_stack = 1e06, dir = "."):
        """
        argp: The system arguments

        target_size: the desired size of the index files to be sent over the web,
        in number of entries.

        max_stack: the maximum number of entries to keep on hand: higher values
        use more memory, but take less I/O.
        """
        self.dir = dir
        ids = []
        last = None
        for i,id in enumerate(id_list):
            ids.append(id)
            last = id
        ids.sort()
        
        self.id_lookup = dict()
        self.index_description = [{"start":ids[0]}]
        for i,id in enumerate(ids):
            if (i % target_size) == (target_size-1):
                self.index_description[-1]["end"] = ids[i-1]
                self.index_description.append({"start":id})
            self.id_lookup[id] = len(self.index_description)-1
            
        # The last one ends at the end.
        self.index_description[-1]["end"] = ids[i]
        if not os.path.exists("{}/index".format(dir)):
            os.makedirs("{}/index".format(dir))

        # Setup the stack size.
        self.stack_size = 0
        self.stack = [[] for i in self.index_description]
        self.max_stack = max_stack

    def which_list_is_longest(self):
        biggest = -1
        for i,row in enumerate(self.stack):
            if len(row) > biggest:
                biggest = i
        return biggest
        
    def flush(self,i):
        if len(self.stack[i])==0:
            return
        
        desc = self.index_description[i]
        indexname = self.dir + "/index/" + ("{}-{}".format(desc["start"],desc["end"]).replace("/","."))
        decrementer = 0

        
        if not os.path.exists(indexname):
            # Write column headers when opening the first time.
            f = open(indexname, "w")
            f.write("\t".join(["id","z","x","y","x_","y_"]) + "\n")
            
        else:
            f = open(indexname, "a")
        
        for row in self.stack[i]:
            decrementer += 1
            try:
                line = u"\t".join(map(ucode,row)) + u"\n"
            except UnicodeDecodeError:
                print (map(ucode,row))
                raise
            f.write(line.encode("utf-8"))
        self.stack_size = self.stack_size - decrementer
        f.close()
        
    def close(self):
        fout = open("index_desc.tsv","w")
        fout.write("\t".join(["start","end","file"]) + "\n")
        for i in range(len(self.stack)):
            self.flush(i)
            desc = self.index_description[i]
            try:
                indexname = "{}/index/{}-{}".format(self.dir, desc["start"],desc["end"])                
                row = "\t".join([desc["start"],desc["end"],indexname]).encode("utf-8")
            except UnicodeDecodeError:
                indexname = u"{}/index/{}-{}".format(self.dir, desc["start"].decode("utf-8"),desc["end"].decode("utf-8"))                
                row = "\t".join([desc["start"].decode("utf-8"),desc["end"].decode("utf-8"),indexname]).encode("utf-8")            
            fout.write(row + "\n")


        fout.close()

def ucode(whatever):
    try:
        return unicode(whatever)
    except:
        return unicode(whatever.decode("utf-8"))

def parse_args(arguments):
    argparse = ArgumentParser('python data tiler')
    argparse.add_argument("-f","--file",help="Input filename of coordinates. Tab or space separated; first row must be column names.")
    argparse.add_argument("-d","--dir", default = ".", help="Output directory name for tiles, indexes, and metadata. Will be created if it does not exist.")
    argparse.add_argument("-m","--metadata", default = None, help="optional additional metadata (same order and length as file). Tab separated, first row gives names.")
    argparse.add_argument("-t","--tile-density", type=int, default = 2500, help="Maximum number of points per tile.")
    argparse.add_argument("-k","--key-index", type=str, default = None, help="Build an index to the identifiers as well: specify the name of the identifier.")
    return argparse.parse_args(arguments)


class LineYielder(object):

    # A class that yields lines from an input column. Essentially a wrapper around a file reader that
    # handles the tsv format being used here that allows a second file.
    
    def __init__(self, argp):
        self.argp = argp
        if argp.file.endswith(".gz"):
            self.mainfile = gzip.open(argp.file)
        else:
            self.mainfile = open(argp.file)
        line = self.mainfile.readline()
        try:
            self.headers = line.rstrip("\n").rstrip("\r").split("\t")
        except TypeError:
            line = str(line)
            self.headers = line.rstrip("\n").rstrip("\r").split("\t")
        print(self.headers)
        if not "x" in self.headers or not "y" in self.headers:
            raise TypeError("You must include x and y as column names")
        print(self.headers)
        if argp.metadata is not None:
            self.metadata = open(argp.metadata)
            metaheader = self.metadata.readline().rstrip("\n").rstrip("\r").split("\t")
            self.headers += metaheader
        self.headers += ["ix"]
            
    def __iter__(self):

        if self.argp.file.endswith("gz"):
            f1 = gzip.open(self.argp.file)
        else:
            f1 = open(self.argp.file)
        
        if self.argp.metadata is not None:
            f2 = open(self.argp.metadata)
        i = 0
        for i,line in enumerate(f1):
            if i == 0:
                continue
            point = line.rstrip('\n').rstrip("\r").split("\t")
            
            if self.argp.metadata is not None:
                point += f2.readline().split("\t")
            point += [i]
            yield point
            
    def indexValues(self):
        self.idloc = self.headers.index(self.argp.key_index)
        for p in self:
            yield p[self.idloc]


def main(arguments):
    argp = parse_args(arguments)


    print("Scanning file")
    logging.info("Scanning file to determine limits") 
    lines = LineYielder(argp)    

    if not os.path.exists(argp.dir):
        os.makedirs(argp.dir)

    
    limits = get_bounds(lines)

    print("Bounds gotten: {}".format(limits))
    
    if os.path.exists("{}/tiles".format(argp.dir)):
        shutil.rmtree('{}/tiles'.format(argp.dir))

    tiler = Datatiler(max = argp.tile_density, x = 0, y = 0, z = 1, xlim = limits[0], ylim = limits[1], headers = lines.headers, dir = argp.dir)

    if argp.key_index:
        indexer = Indexer(lines.indexValues(), dir = argp.dir)

    parsed_so_far = 0

    for i, point in enumerate(lines):
        row_data = tiler.insert(point)
        if argp.key_index is not None:
            indexer.insert([point[lines.idloc]] + row_data)
        # Every fifty inserts, make sure there aren't too many open files.
        
        if i % 250 == 0:
            max_size = argp.tile_density * 1000
            max_files = 512
            dump_below_size = argp.tile_density
            while tiler.n_stacked_items() > max_size and tiler.n_open_files() > max_files:
                # Try to find a good threshold for dumping.
                dump_below_size = dump_below_size * .75
                print("Dumping below {}".format(dump_below_size))
                tiler.flush_files_above_size(dump_below_size)
                
        parsed_so_far += 1

        
    tiler.flush_files_above_size(0)
    
    if argp.key_index:
        indexer.close()
    
    tiler.close_file()
    tiler.close_children()
    
    settings = open("{}/data_description.json".format(argp.dir), "w")
    settingdict = {
        "limits": limits,
        "max_zoom": tiler.points_contained/tiler.max,
        "tile_depth": tiler.max
    }
    
    json.dump(settingdict,settings)
    
if __name__=="__main__":
    main(sys.argv[1:])
