import { scaleLog, scaleSequential, scaleLinear, scaleQuantize, scaleThreshold, scalePow, scaleOrdinal } from 'd3-scale';
import { format as d3Format } from 'd3-format';
import { range, extent, max, min, mean } from 'd3-array';
import { easeCubicOut, easeSinInOut } from 'd3-ease';
import { timer as d3Timer, timerFlush } from 'd3-timer';
import { quadtree as modquadtree } from 'd3-quadtree';
import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom';
import {
  schemePiYG,
  schemeYlOrBr,
  schemeSet2,
  schemeAccent,
  interpolateViridis,
  schemeCategory10,
  schemeSet3,
} from 'd3-scale-chromatic';
import { select, selectAll, event, mouse } from 'd3-selection';
import { map, keys, set } from 'd3-collection';
import * as d3Fetch from 'd3-fetch';

export default function infinite_scatter(selector, width = 600, height = 400) {
  const that = {};
  const max_index_size = 3e05;

  const default_time = 6000;

  // Set up the search box elements.
  let wordlist = '_';
  let word_index = {};


  let canvas_element;
  const animation_timers = [];

  let click_function = function (d) {
    console.log(d);
    const id = (d.id || d.htid);
    window.open(`http://babel.hathitrust.org/cgi/pt?id=${id}`);
  };

  
  const street_click = function (d) {
    let q = d.name;
    q = q.replace(' ', '%20');
    window.open(`https://www.mapquest.com/search/results?query=${q}%20(Road)&boundingBox=46.07323062540835,-125.72753906249999,28.92163128242129,-66.9287109375&page=0`);
  };

  let scheme = 'light';

  let canvas; 
  function initialize_canvas() {
    const node = select(selector).node();
    canvas_element = select(selector).selectAll('canvas');

    if (canvas_element.empty()) {
      canvas_element = select(selector).append('canvas');
    }

    canvas_element
      .attr('width', width)
      .attr('height', height)
      .style('background', (d) => {
        if (scheme === 'light') return 'white';
        if (scheme === 'dark') return 'black';
        if (scheme === 'streets') return 'white';
      });

      that.canvas(canvas_element);
      canvas = canvas_element
              .node()
              .getContext('2d');
      return that;
  }

  let svg;
  let point_layer;
  let legend_layer;

  that.canvas = function (x) {
    if (x) {
      canvas_element = x;
      // width = x.attr('width');
      // height = x.attr('height');

      if (svg === undefined) {
        svg = select(canvas_element.node().parentNode)
          .append('svg')
          .attr('width', width)
          .attr('height', height)
          .style('position', 'absolute')
          .style('top', 0)
          .style('left', 0);

        point_layer = svg.append('g').attr('id', 'point-layer');

        legend_layer = svg.append('g').attr('id', 'legend-layer');
      }

      return that;
    }
    return canvas_element;
  };

  initialize_canvas();

  const drawn = {point: [], label: []};

  const x_buffer = width < height ? 0 : ((width - height) / 2);
  const x_ = scaleLinear()
    .range([0 + x_buffer, width - x_buffer]);

  let x = x_;

  const y_buffer = height < width ? 0 : (height - width) / 2;
  const y_ = scaleLinear()
    .range([0 + y_buffer, height - y_buffer]);
  let y = y_;

  let cards;
  // A cache of everything we've ever seen. It can be pruned, if need be, to
  // release memory. Keys are strings of the form "z,x,y"
  const stored_tiles = {};

  // Bad practice, but I need it.
  that.cache = stored_tiles;
  // A continuously-updated variable that remembers what's in frame.
  const visible_quadrants = set([]);

  let variable_point_size = true;
  that.variable_point_size = function (x) {
    if (x !== undefined) {
      variable_point_size = x;
      try {
        select('#point_size_slider').node().value = x;
      } catch (err) {
        null;
      }
      return that;
    }
    return variable_point_size;
  };

  let default_color;


  function alignSchemeColor() {
    if (scheme === 'streets') {
      if (font === 'SantaBarbaraStreetsMedium') {
        default_color = '#4E2F2F';
      } else {
        default_color = 'rgba(48,132,70,1)';
      }
    } else {
      default_color = 'rgba(5,5,5,.6)';
    }
  }

  that.scheme = (x) => {
    if (x !== undefined) {
      scheme = x;
      initialize_canvas();
      alignSchemeColor();
      return that;
    }
    return scheme;
  };


  let variable_text_size = false;
  that.variable_text_size = function (x) {
    if (x !== undefined) {
      variable_text_size = x;
      return that;
    }
    return variable_text_size;
  };


  const pointsizer = scalePow().exponent(1 / 3).domain([0, 70000]).range([5, 0.85]);

  let size_goal = function () { return pointsizer(n_visible); };

  that.point_size = function (x) {
    // point_size can be either a number of pixels,
    // or a function that returns a number of pixels
    if (!x) {
      return size_goal;
    }
    size_goal = x;
    return that;
  };

  const lookups = {};

  that.add_key = function (variable_name, file) {
    lookups[variable_name] = {};
    return d3Fetch.tsv(`${base_dir}/${file}`).then((data) => {
      data.forEach((d) => {
        lookups[variable_name][d.key] = d.label;
      });
    });
  };

  var n_visible = 1000;

  let point_opacity = 0.8;
  that.point_opacity = function (x) {
    if (!x) {
      return point_opacity;
    }
    point_opacity = x;
    return that;
  };

  let text_areas;

  function initialize_cards(parentNode = selector) {
    let parent = select(parentNode)
      .selectAll('div.data-control');

    if (parent.empty) {
      parent = select(parentNode).append('div')
        .attr('class', 'data-control');
    }

    cards = parent
      .append('div')
      .attr('aria-multiselectable', 'true');
  }

  that.add_card_section = function (title, text, id, card) {
    const uid = id || `section${Math.random()}`;
    if (!card) {
      card = cards;
      if (!card) {
        initialize_cards();
        card = cards;
      }
    }
    const parent = card;

    const parentID = parent.attr('id');

    const group = parent.append('div')
      .attr('class', 'card');

    var title = group
      .append('div')
      .attr('class', 'card-header')
      .append('a')
      //          .attr('class', 'btn btn-info')
      .attr('data-toggle', 'collapse')
      .attr('data-parent', '#cards')
      .attr('href', `#${uid}`)
      .attr('aria-expanded', 'true')
      .attr('aria-controls', uid)
      .text(title);

    const body =
            group
              .append('div')
              .attr('id', uid)
              .attr('aria-labelledby', uid)
              .attr('class', 'collapse')
              .attr('role', 'tabpanel')
              .append('div')
              .attr('class', 'card-body')
              .html(text);

    return body;
  };

  that.add_search_box = function () {
    const search = that.add_card_section('Search for a word', '', 'searchcard');
    const box = search.append('input').attr('id', 'search');

    box.on('keyup', (d) => {
      if (event.key === 'Enter') {
        that.zoom_to_word(select('#search').node().value);
      }
    });

    search.append('button').text('find word').on('click', (d) => {
      that.zoom_to_word(select('#search').node().value, 5000);
    });

    return that;
  };

  let narrative;

  let sequence_exists = false;
  that.add_sequence_point = function (title, action) {
    if (!sequence_exists) {
      var div = that
        .add_card_section('Navbar', '', 'navstory')
        .append('div')
        .attr('id', 'nav_points');
      sequence_exists = true;
    } else {
      var div = select('#nav_points');
    }

    div
      .append('a')
      .text(`${title}---`)
      .style('font-size', '8px')
      .on('click', action);
  };

  that.bind_window_resize = function () {
    select(window).on('resize', () => {
      updateBBox();
      canvas_element.attr('width', width);
      canvas_element.attr('height', height);

      svg.attr('width', width);
      svg.attr('height', height);

      x_.range([0, width]);
      y_.range([0, height]);

      that.redraw();
    });
    return that;
  };


  let point_threshold = 1.5;
  that.point_threshold = function (x) {
    if (x) {
      point_threshold = x;
      const slider = select('#density_slider');
      if (!slider.empty()) { slider.node().value = Math.sqrt(x); }

      return that;
    }
    return point_threshold;
  };

  let label_threshold = 0.25;

  that.label_threshold = function (x) {
    if (x !== undefined) {
      label_threshold = x;
      try {
        select('#label_threshold_slider').node().value = Math.sqrt(x);
      } catch (err) {
        null;
      }
      return that;
    }
    return label_threshold;
  };


  that.click = function (x) {
    if (x) {
      click_function = x;
      return that;
    }
    return click_function;
  };

  let top_n_filter = 0;
  const top_n_thresh = 0;

  function set_top_n_filter() {
    let whitelist = that.top_n_colors(top_n_filter, top_n_thresh).map(d => d.label);
    whitelist = set(whitelist);
    additional_filters.top_n_filter = function (d) { return whitelist.has(d[colorize_by]); };
  }

  that.show_only_n_categories = function (n, thresh) {
    // Handle with care; be sure to unregister
    if (n > 0) {
      top_n_filter = n;
    } else {
      top_n_filter = 0;
      that.delete_filter('top_n_filter');
    }
  };

  that.slowly = function (key, value, time = default_time) {
           
    const tscale = scaleLinear()
      .domain([0, time])
      .range([that[key](), value])
      .clamp(true);

    const t = d3Timer((elapsed) => {
      that[key](tscale(elapsed));
      updateData();
      if (elapsed > tscale.domain()[1]) {
//        console.log('timer complete');
        t.stop();
      }
    });
    animation_timers.push(t);
  };

  let last_top_n_time = new Date().getTime();
  let last_top_n_value;

  that.top_n_colors = function (n, thresh) {
    // This function is expensive, so I don't want to run it more than
    // twice a second.
    const time = new Date().getTime();
    if ((time - last_top_n_time) < 666 && last_top_n_value !== undefined) {
      return last_top_n_value;
    }
    last_top_n_time = time;


    // returns the top n colors that represent at least
    // fraction thresh of the visible data.

    var n = n || 10;
    if (thresh === undefined) {
      thresh = 0.001;
    }

    var dat = {};


    // Divide the screen into 144 squares.
    const binning = 15;

    const x_mapper =
            scaleQuantize()
              .range(range(binning))
              .domain(x.domain());
    const y_mapper =
            scaleQuantize()
              .range(range(binning))
              .domain(y.domain());

      // We can't use an existing top_n_filter to determine how we'll build the new one,
      // because then nothing new could ever be added.

    const local_filters = {};

    keys(additional_filters).forEach((key) => {
      if (key !== 'top_n_filter') { local_filters[key] = additional_filters[key]; }
    });

    visible_quadrants
      .values()
      .forEach((quad) => {
        const q = stored_tiles[quad];
        if (!q || !q.data) { return; }
        q.data.forEach((d) => {
          if (is_visible(d, local_filters)) {
            const label = d[colorize_by];
            if (!label) { return; }
            const xx = +d.x;
            const xxx = x_mapper(xx);
            const yy = +d.y;
            const yyy = x_mapper(yy);
            const grid_point = `${x_mapper(xx)}-${y_mapper(yy)}`;
            if (!dat[label]) {
              dat[label] = { label };
              // For easier scaling later inherit the property too.
              // May screw things up if someone uses "x" or "n" or "points"
              // as a categorical variable name.
              dat[label][colorize_by] = label;
            }
            if (!dat[label].points) { dat[label].points = {}; }
            dat[label].points[grid_point] = dat[label].points[grid_point] + 1 || 1;
            dat[label].x = dat[label].x + xx || +xx;
            dat[label].y = dat[label].y + yy || +yy;
            dat[label].n = dat[label].n + 1 || 1;
          }
        });
      });

    let tot = 0;
    dat = keys(dat).map(key => dat[key]);
    dat.forEach((d) => {
      tot += d.n;
    });


    // Filter to > 1%, and make sure there's data.
    var dat = dat.filter((d) => {
      /**
         // It'd be nice to have various different labels, but it's hard.
         var min_to_display = (1/binning)/3
         // What's the minimum for a group to be contiguous?
         // We'll call it 1/3 the average density for the item.
         function find_parent(i,j) {
         var node = d.points["" + i + "-" + j]
         if (node.n < min_to_display) {return}
         var neighbors = [[i,j-1],[i-1,j],[i,j+1],[j+1,i]]
         neighbors.forEach(function(pair) {
         var node2 = d.points["" + pair[0] + "-" + pair[1]]
         if (node2.n < min_to_display) {return}
         if (node2.parent) {
         if (node2.parent.n >= node.n) {
         node2.parent.children.push(node)
         node.parent = node2.parent
         } else {
         node2.parent.n
         }
         }

         })
         }
         * */

      if (d.n < tot * thresh || d.n < 5) { return false; }


      d.label_points = [];
      d.mode_x = undefined;
      d.mode_y = undefined;
      d.mode_n = -1;
      keys(d.points).forEach((pname) => {
        if (d.points[pname] > d.mode_n) {
          d.mode_n = d.points[pname];
          const p = pname.split('-');

          d.mode_x = x(mean(x_mapper.invertExtent(+p[0])));
          d.mode_y = y(mean(y_mapper.invertExtent(+p[1])));
        }
      });

      return true;
    });

    dat.sort((a, b) => b.n - a.n);

    last_top_n_value = dat.slice(0, n);
    return last_top_n_value;
  };


  function format_name(d, key) {
    if (!lookups[key]) { return d[key]; }
    return lookups[key][d[key]];
  }


  that.annotate_legend = function () {
    const n = top_n_thresh || 10;

    selectAll('div.ttooltip').remove();

    const dat = that.top_n_colors(n, 0.003);

    const labels = legend_layer.selectAll('g.legend').data(dat, d => d.label);

    labels.exit().remove();

    const entered = labels.enter()
      .append('g')
      .attr('class', 'legend')
      .attr('transform', d => `translate(${d.mode_x},${d.mode_y})`);

    entered
      .append('rect')
      .attr('class', 'bboxLabel')
      .style('fill-opacity', 0.85)
      .attr('rx', 15)
      .attr('ry', 15)
      .style('fill', scheme === 'light' ? 'white' : 'black');

    entered
      .append('text')
      .attr('class', 'legend')
      .text(d => format_name(d, colorize_by))
      .style('font-size', d => '36px')
      .attr('text-anchor', 'middle');

    //        select("svg")
    //            .style("background","rgba(255,255,255,.2)")
    //            .style("opacity",1)


    let old_filter;

    function turn_on_from_point(d) {
      legend_layer.selectAll('g.legend')
        .classed('muted', e => d[colorize_by] !== e[colorize_by])
        .classed('highlit', e => d[colorize_by] === e[colorize_by]);


      additional_filters.hover_effect = function (datum) {
        return datum[colorize_by] === d[colorize_by];
      };

      //      setTimeout(() => {
      that.redraw();
      //      }, 50);
    }

    function turn_off_from_point(d) {
      delete (additional_filters.hover_effect);
      // Clear all added classes
      legend_layer.selectAll('g.legend').classed('muted', false).classed('highlit', false);
      that.redraw();
    }


    labels
      .merge(entered)
      .style('fill', d => colors(d.label))
      .on('mousemove', () => {

      })
      //            .on("mouseover",function(d) {
      // svg.on("mousemove",function() {})
      //            })
      //            .on("mouseout", function (d) {
      // svg.on("mousemove",mouseQuadtreeSearch)
      //      })
      .on('click', function (d) {
        if (select(this).classed('highlit')) {
          turn_off_from_point(d);
        } else {
          turn_on_from_point(d);
        }
      })
      .each(function (d) {
        d.bbox = select(this).select('text').node().getBBox();
        const pad = 10;

        select(this)
          .selectAll('rect')
          .attr('x', d.bbox.x - pad)
          .attr('y', d.bbox.y - pad)
          .attr('width', d.bbox.width + pad * 2)
          .attr('height', d.bbox.height + pad * 2);
      })
      .transition()
      .attr('transform', d => `translate(${d.mode_x},${d.mode_y})`);
  };

  var additional_filters = {

  };

  that.zoom_to_word = function (word, duration) {
    word = word.replace('/', '.'); // <- Because foldernames are a problem.
    // This will introduce bugs somewhere!

    // Zoom to a particular id on the chart.

    // Wait for the file to load.

    if (wordlist === '_') { setTimeout(() => { that.zoom_to_word(word); }, 500); }

    if (word_index[word]) {
      const p = word_index[word];
      that.zoom_to(max([40, +p[0]]), +p[1], +p[2], duration);
      return;
    }

    let fname;
    wordlist.some((chunk) => {
      if (word < chunk.end) {
        fname = chunk.file;
        return true;
      }
      return false;
    });

    if (word_index.length > max_index_size) {
      word_index = {};
    }
    if (!fname) { return; }

    d3Fetch.tsv(fname).then((data) => {
      data.forEach((d) => {
        word_index[d.id] = [max([32, d.z * 1.8]), d.x_, d.y_];
      });
      if (word_index[word]) {
        that.zoom_to_word(word);
      }
    });
  };

  that.promiseIndex = function () {
    return d3Fetch.tsv(`${base_dir}/index_desc.tsv`).then((data) => { wordlist = data; });
  };


  const prefs = {
    label_field: undefined,
    colorize_by: undefined,
    scale_type: {},
  };

  that.appearance = prefs;

  that.filter = function (x) {
    prefs.filter = x;
  };

  that.label = function (x) {
    if (x) {
      label_field = x;
      return that;
    }
    return label_field;
  };

  let draw;
  let colors = function () {};
  let labels;

  that.colorscale = colors;


  function set_default_colors() {
    return d3Fetch.tsv(`${base_dir}/tiles/1/0/0.tsv`, d => parseRow(d, 1, 'foo'))
      .then((data) => {
        const lab = [];
        const col = {};
        keys(data[0])
          .filter(k => ['x', 'y', 'htid', 'id', 'zoom', 'ix', 'Xwidths', 'quadrant', 'base_zoom'].indexOf(k) === -1)
          .forEach((k) => {
            col[k] = {};
            lab.push(k);
          });
        colorscheme = col;
        color_labels = lab;
        //        that.redraw();
      });

    update_color_scale();
  }


  let base_dir = '/';

  that.base_dir = (dir) => {
    if (dir) {
      base_dir = dir;

      if (dir === '/data/scatter/streets') {
        // yuck
        click_function = street_click;
      }

      return that;
    }
    return base_dir;
  };


  // Allowed values; untruthy, 'actual', and 'theoretical'.
  let debug;

  that.debug = (v) => {
    if (v !== undefined) {
      debug = v;
      return that;
    }
    return debug;
  };

  let font;
  let font_style;

  that.font = (v) => {
    if (v !== undefined) {
      if (font == 'Overpass') {
        font_style = 'bold';
      } else {
        font_style = '';
      }
      font = v;
      alignSchemeColor();
      return that;
    }
    return font;
  };

  that.font('Arial');


  const api = {};

  that.colorize_by = (val) => {
    if (val === undefined) {
      return colorize_by;
    }
    colorize_by = val;
    return that;
  };

  let collision_detection = true;
  that.collisionDetection = (val) => {
    if (val === undefined) {
      return collision_detection;
    }
    collision_detection = val;
    return that;
  };
        
  that.label_field = (val) => {
    if (val === undefined) {
      return label_field;
    }
    label_field = val;
    return that;
  };

  function change(key, node) {
    const api_call = {};
    api_call[key] = node.value;
    that.plotAPI(api_call);
  }

  function update_color_scale() {
    if (scheme === 'light') {
      colors = scaleOrdinal(schemeCategory10);
    } else {
      colors = scaleOrdinal(schemeSet3);
    }

    const datefields = set(['date', 'year', 'inferreddate', 'record_date']);

    if (datefields.has(colorize_by)) {
      colors = scaleSequential()
        .interpolator(interpolateViridis)
        .domain([1800, 2000]);
    }
    if (prefs.scale_type[colorize_by] === 'gradient2') {
      colors = scaleLinear().domain([-0.4, 0, 0.4]).range(['blue', 'grey', 'red']);
    }
  }


  that.updateFromAPI = function (calls, plot, state) {
    // calls: an object of API calls.
    // plot: whether to draw or just update
    // state; if updating, whether to target the start of end state of the transition.

    const callable = set([
      'label_threshold',
      'point_size',
      'scheme',
      'font',
      'debug',
      'point_opacity',
      'point_threshold',
      'variable_point_size',
      'variable_text_size',
      'base_dir',
      'hide_uncolored',
      'show_only_n_categories',
      'color_legend_toggle',
      'colorize_by',
      'label_field',
      'collisionDetection'
    ]);

      // If not plotting, set to the final state.

    if ((plot == false) && calls.slowly && state !== 'start') {
      calls.slowly
        .forEach((s) => {
          calls[s.field] = s.value;
        });
      calls.slowly = undefined;
    }

    keys(calls).forEach((key) => {
      const val = calls[key];

      if (callable.has(key)) {
        // Exposed directly as functions, too.
        console.log(`Setting ${key} to ${val}`);
        that[key](val);
      } else if (key === 'filters' || key === '+filters') {
        if (key === 'filters') {
          that.clear_filters();
        }
        that.filters(val);
      } else if (key === 'keys') {
        keys(val).forEach((k2) => {
          that.add_key(k2, val[k2]);
        });
      }
    });
    // Slowly happens after the starting values have been written in.
    if (calls.slowly && plot) {
      calls.slowly.forEach((dicto) => {
        that.slowly(dicto.field, dicto.value, dicto.duration);
      });
    }
  };

  let colorize_by;
  let label_field;

  that.add_color_legend = function () {
    const buttons = that.add_card_section('Colors', '', 'color-legend');
    const col = colorscheme;

    const color_options = keys(col);

    color_options.forEach((d) => {
      prefs.scale_type[d] = col[d];
    });

    colorize_by = color_options[0];
    label_field = color_labels[0];


    const button = buttons.append('div')
      .append('button')
      .attr('class', 'color_legend_button')
      .text('Show color legend')
      .on('click', color_legend_toggle);


    let col_select = buttons
        .append('div')
        .text('colorize by: ')
        .append('select')
        .on('change', function (d) { change('colorize_by', this); }),

      col_options = col_select.selectAll('option').data(color_options); // Data join

    col_options.enter().append('option').text(d => d);

    const colorizing_select = select('buttons')
      .append('select');

    const colorizing = colorizing_select
      .selectAll('option')
      .data(color_options);

    colorizing.append('option').text(d => d);

    function color_legend_toggle(force_to) {
      const master_button = selectAll('.color_legend_button');
      let is_on;
      if (force_to === 'on') { is_on = false; } else if (force_to === 'off') { is_on = true; } else { is_on = master_button.classed('displaying'); }
      if (!is_on) {
        //        that.redraw();
        that.annotate_legend();
        master_button.classed('displaying', true);
        master_button.text('Hide color legend');
      } else {
        legend_layer.selectAll('.legend').remove();
        svg.style('background', 'rgba(255,255,255,0)');
        master_button.classed('displaying', false);
        master_button.text('Show color legend');
      }
    }

    that.color_legend_toggle = color_legend_toggle;
  };

  that.add_filter_legend = function () {
    const buttons = that.add_card_section('Filters', 'Use a search term or regular expression to filter points.', 'filter-legend');

    buttons.append('button')
      .on('click', () => {
        that.clear_filters();
        select('#regex-filter').node().value = '';
        that.hide_uncolored(false);
        prep_regex_filter();
        that.plotAPI();
      })
      .text('Drop all filters');

    const filter_holder = buttons.append('div').append('span').text('Limit ');
    const filter_options = filter_holder
      .append('select')
      .attr('id', 'regex-filter-field')
      .on('change', function (d) {
        prefs.filter = select(this).node().value;
        prep_regex_filter();
        that.plotAPI();
      });

    const color_options = keys(colorscheme);
    // unique of both
    const d = set(color_options.concat(labels)).values();
    prefs.filter = d[0];
    const f_options = filter_options.selectAll('option').data(d); // Data join
    f_options.enter().append('option').text(d => d);

    filter_holder.append('text').text(' to match ');

    filter = filter_holder.append('input').attr('id', 'regex-filter')
      .on('keyup', () => {
        prep_regex_filter();
        that.plotAPI();
      });
  };

  that.add_label_legend = function () {
    const buttons = that.add_card_section('Labels', '', 'label-legend');

    const label_thresh_div = buttons.append('div');

    let col_select = buttons
        .append('div')
        .text('Label by: ')
        .append('select')
        .on('input', function (d) { change('label_field', this); })
        .on('change', function (d) { change('label_field', this); }),

      col_options = col_select.selectAll('option').data(color_labels); // Data join

    col_options.enter().append('option').text(d => d);

    // Enter selection


    buttons.append('text').text('% of points w/ labels');
    buttons
      .append('input')
      .attr('id', 'label_threshold_slider')
      .attr('type', 'range')
      .attr('min', 0)
      .attr('max', 1)
      .attr('step', 0.02)
      .on('input', label_threshold_change)
      .on('change', label_threshold_change);

    function label_threshold_change() {
      const val = select(this).node().value;
      that.plotAPI({ label_threshold: val * val });
    }
  };

  that.color_legend_toggle = () => undefined;

  that.add_legend = function (col, lab) {
    const buttons = that.add_card_section('Points', '', 'legend');

    function point_change() {
      const val = +select(this).node().value;

      if (val === +select('#density_slider').attr('max')) {
        select('#density_slider').attr('max', val + 0.5);
      }

      that.plotAPI({ point_threshold: (val * val) });
    }

    const density_bar = buttons.append('div');
    density_bar.append('text')
      .text('Number of points ');

    density_bar
      .append('input')
      .attr('id', 'density_slider')
      .attr('type', 'range')
      .attr('min', 1)
      .attr('max', 4.99)
      .attr('step', 0.01)
      .attr('defaultValue', 1)
      .on('input', point_change)
      .on('change', point_change);

    density_bar
      .append('text')
      .attr('id', 'pointcount');

    function size_change() {
      const val = select(this).node().value;
      that.plotAPI({ point_size: val });
    }


    const point_size_div = buttons.append('div');
    point_size_div.append('text').text('Point size');
    point_size_div
      .append('input')
      .attr('id', 'point_size_slider')
      .attr('type', 'range')
      .attr('min', 0.5)
      .attr('max', 5)
      .attr('step', 0.05)
      .on('input', size_change)
      .on('change', size_change);


    return that;
  };

  let filter;

  that.where_am_i = function () {
    const xx = x.invert(width / 2);
    const yy = y.invert(height / 2);
    const zz = transform.k;
    const code = select('.chunk.graph-scroll-active').selectAll('pre.api').select('code');
    const current = JSON.parse(code.text());

    current.zoom = [Math.round(zz * 50) / 50, Math.round(xx * 1000) / 1000, Math.round(yy * 1000) / 1000];
    code.text(JSON.stringify(current).replace(/,"/g, '\n  ,"'));

    return `"zoom": [${zz}, ${xx}, ${yy}]`;
  };

  function prep_regex_filter() {
    // Don't want to compile a regex thousands of times.
    // This should be called whenever the regex is changed.

    const regex_filter = selectAll('#regex-filter');

    if (regex_filter.empty()) { return; }

    const regex = regex_filter.node().value;


    // Clear existing filters
    keys(additional_filters).forEach((key) => {
      if (key.startsWith('regex')) {
        delete additional_filters[key];
      }
    });

    if (regex == '') { return; }
    that.add_regex_filter(regex, prefs.filter);
  }

  that.add_regex_filter = function (regex_filter, field) {
    const regex = new RegExp(regex_filter);

    const filter_function = function (d) {
      if (!d[field]) {
        return false;
      }
      if (d[field].match(regex)) {
        return true;
      }
      return false;
    };
    additional_filters[`regex_${field}`] = filter_function;
  };


  that.clear_filters = function () {
    str_filters = {};
    additional_filters = {};
    prep_regex_filter();
  };

  that.redraw = function () { throw ('Redrawing before chart created...'); };

  that.add_filter = function (f, label, redraw) {
    label = label || Math.random().toString(36);
    additional_filters[label] = f;
    //    that.redraw();
  };

  that.delete_filter = function (label) {
    if (additional_filters[label]) {
      delete additional_filters[label];
    }
  };


  let str_filters = {};

  that.filters = function (dict_of_filters) {
    if (dict_of_filters === undefined) {
      // Return the string-formatted versions so they can
      // be interpolated against.
      return str_filters;
    }

    keys(dict_of_filters).forEach((k2) => {
      const val = dict_of_filters[k2];

      // Store the called version.

      str_filters[k2] = val;
      if (val.arguments) {
        that.add_filter(val, k2);
      } else if (val.startsWith('/') && val.endsWith('/')) {
        that.add_regex_filter(val.slice(1, -1), k2);
      } else {
        const f = Function('d', `return ${val}`);
        that.add_filter(f, k2);
      }
    });
  };
  let mouseQuadtreeSearch;
  let transform = zoomIdentity;

  function is_visible(d, filters) {
    filters = filters || additional_filters;
    // Is it visible on the zoom function?
    if (d.zoom >= transform.k * point_threshold) {
      return false;
    }
    // Is it filtered out for metadata?
    const keylist = keys(filters);
    for (let i = 0; i < keylist.length; i++) {
      if (!filters[keylist[i]](d)) {
        return false;
      }
    }

    if (hide_uncolored) {
      if (!uncolored_filter(d)) {
        return false;
      }
    }

    // Is it in the field of view?

    d.cx = x(d.x);
    d.cy = y(d.y);
    if (d.cx > 0 && d.cx < width && d.cy > 0 && d.cy < height) {
      return true;
    }
    // return true;
    return false;
  }

  function uncolored_filter(d) {
    return (d[colorize_by]);
  }


  var hide_uncolored = false;

  that.hide_uncolored = function (true_false) {
    if (true_false === undefined) {
      return hide_uncolored;
    }
    hide_uncolored = true_false;
    return that;
  };

  that.redraw_frames = [];


  const coord_equal = true;

  let updateData; // defined in the scoping of "create"
  that.updateData = updateData;

  let creationPromise;

  let colorscheme;
  let color_labels;

  that.create = function (calls) {
    // This structure is ugly because it inherits an old callback hell.
    // Partly overwritten by promises.


    // Don't do this creation process twice.
    if (creationPromise) { return creationPromise; }
    // an asynchronous function

    that.updateFromAPI(calls, false, 'start');

    creationPromise =
        set_default_colors()
          .then(() => d3Fetch.json(`${base_dir}/data_description.json`))
          .then((settings) => {
            if (calls.guides) {
            // Build the interactive infrastructure.
              calls.guides.forEach((guide) => {
                this[`add_${guide}`]();
              });
            }

            x_.domain([settings.limits[0][0], settings.limits[0][1]]);
            y_.domain([settings.limits[1][0], settings.limits[1][1]]);

            const zm = d3Zoom()
              .scaleExtent([1, settings.max_zoom * 12])
              .on('zoom', zoom);
            // nb: zoom is applied to the overlying svg, *not* the underlying canvas.
            // The canvas simply uses the svg scales when it draws without being aware of size.

            function zoom() {
              transform = event.transform;
              x = event.transform.rescaleX(x_);
              y = event.transform.rescaleY(y_);
              updateData();
              const d = new Date();
              const n = d.getTime();
              that.redraw_frames.push(n);
            }

            transform = zoomIdentity;

            that.zoom_to = function (zoom_level, x_pt, y_pt, transition_time = default_time) {
              that.create().then(() => {
                const new_point = zoomIdentity
                  .translate(width / 2, height / 2)
                  .scale(zoom_level)
                  .translate(-x_(x_pt), -y_(y_pt));

                select('svg')
                  .transition()
                  .duration(transition_time)
                  .ease(easeSinInOut)
                  .call(zm.transform, new_point);
              });
            };

            const quadtree = function () {
            // replicating v3 generator behavior
              return modquadtree()
                .extent([[settings.limits[0][0], settings.limits[1][0]], [settings.limits[0][1], settings.limits[1][1]]])
                .x(d => d.x)
                .y(d => d.y);
            };


            // These will be recast by zoom
            x = x_;
            y = y_;


            // if greater than one, show tiles from this far down.

            function update_visible_quadrants() {
              visible_quadrants.values().map((d) => {
                visible_quadrants.remove(d);
              });
              const xlim = [x.invert(0), x.invert(width)];
              const ylim = [y.invert(0), y.invert(height)];

              const limits = settings.limits;

              for (let level = 1; level / point_threshold <= transform.k; level *= 2) {
                const y_scale = scaleLinear().domain(limits[1]).range([0, level - 0.00000001]);
                const x_scale = scaleLinear().domain(limits[0]).range([0, level - 0.00000001]);
                const quads_x = xlim.map(x => Math.floor(x_scale(x)));
                const quads_y = ylim.map(y => Math.floor(y_scale(y)));

                range(quads_x[0], quads_x[1] + 1).forEach((x) => {
                  range(quads_y[0], quads_y[1] + 1).forEach((y) => {
                    visible_quadrants.add([level, x, y]);
                  });
                });
              }
            }

            updateData = function () {
              update_visible_quadrants(x.domain(), y.domain());
              const needed_tiles = visible_quadrants
                .values()
                .map((d) => {
                  const n = d.split(',');
                  add_tile(+n[0], +n[1], +n[2]);
                });

              Promise.all(needed_tiles).then(() => {
              // Once all tiles are loaded, redraw.
                that.redraw();
              });
            };

            // A mapping of theoretical tile to compressed
            // (stacked) tiles.
            const tile_promises = {};

            function parentTile(rz, rx, ry) {
              return [rz / 2, Math.floor(rx / 2), Math.floor(ry / 2)];
            }


            function promise_tile(rz, rx, ry) {
            // Returns a promise containing the maximum point depth
            // of the tile. This is used by child tiles to determine if they
            // actually need to load.

            // Important side effect is to
            // actually load the tile and cache its contents.

              const key = [rz, rx, ry].join(',');

              if (tile_promises[key]) {
                return tile_promises[key];
              }

              if (ry >= rz || rx >= rz || ry < 0 || rx < 0) {
              // These are the outer bounds of the visualization. Don't
              // bother trying to get tiles outside them; they can't exist.
                tile_promises[key] = Promise.resolve(Infinity);
                return Promise.resolve(Infinity);
              }

              tile_promises[key] = d3Fetch
                .tsv(`${base_dir}/tiles/${rz}/${rx}/${ry}.tsv`, d => parseRow(d, rz, key))
                .catch(d =>
                // If the tile doesn't exist, it has no children.
                  undefined)
                .then((data) => {
                  if (data === undefined) { return Infinity; }
                  const nrow = data.length;
                  data.forEach((d, i) => {
                    d.zoom = d.ix / settings.tile_depth;
                    if (scheme == 'streets') {
                      if (d.name == '</s>') {
                        d.name = '';
                      } else {
                        d.name = d.name.replace(/_/g, ' ');
                      }
                    }
                  })
                        
                  stored_tiles[key] = { data, quadtree: quadtree([]) };
                  window.foo = stored_tiles;
                  let max_depth = data[data.length - 1].ix / settings.tile_depth;

                  if (data.length < settings.tile_depth) {
                    // There are no children if it ends before the tile depth.
//                    console.log('No children ', rz, rx, ry, data.length);
                    max_depth = Infinity;
                  }

                  data.forEach((d) => {
                    stored_tiles[key].quadtree.add(d);
                  });

                  svg
                    .on('tap', (d) => { console.log('tap'); })// ;mouseQuadtreeSearch)
                    .on('mousemove', mouseQuadtreeSearch)
                    .call(zm);
                    
                  select(svg.node().parentNode).on('wheel', () => {
                    // Gah. Sometimes the event seems to bubble up as
                    // a scroll. This seems to stop it.
                    event.preventDefault();
                  });
                  that.redraw()
                  return max_depth;
                });

              return tile_promises[key];
            }
            that.promise_tile = promise_tile;

            that.tile_promises = tile_promises;

            function add_tile(rz, rx, ry, needed_zoom) {
            // Ensures that the needed_zoom for a given tile
            // is loaded into memory.
              needed_zoom = needed_zoom || transform.k * point_threshold;
              const key = [rz, rx, ry].join(',');

              if (rz > settings.max_zoom || rz < 1) {
              // Don't try to zoom in farther than the deepest tile, or
              // wider than tile number 1.
                return Promise.resolve(0);
              }

              if (ry >= rz || rx >= rz || ry < 0 || rx < 0) {
              // These are the outer bounds of the visualization. Don't
              // bother trying to get tiles outside them; they can't exist.
                return Promise.resolve(0);
              }

              if (tile_promises[key]) {
                return tile_promises[key];
              }

              const parent = parentTile(rz, rx, ry);

              return add_tile(parent[0], parent[1], parent[2], needed_zoom)
                .then((highest_zoom_above) => {
                  if ((highest_zoom_above) > needed_zoom) {
                    return Promise.resolve(highest_zoom_above);
                  }
                  return promise_tile(rz, rx, ry);
                });
            }


            const presets = [];

            const buttons = select('#buttons').append('div').attr('display', 'float').selectAll('button')
              .data(presets);

            buttons.enter().append('button').on('click', (d) => { d.function(); }).text(d => d.name);


            that.redraw = function (return_points = false) {
            // Draw is called more often than redraw.

            // Return points--do we want a list of every point that was drawn?

              canvas.clearRect(0, 0, width, height);
              if (scheme === 'streets') {
                canvas.fillStyle = '#80BFEB';
                canvas.fillRect(0, 0, width, height);
              }
              point_layer.selectAll('rect').remove();

              const master_button = selectAll('.color_legend_button');
              const is_on = master_button.empty() ? false : master_button.classed('displaying');

              if (is_on) {
                that.annotate_legend();
              }

              return draw(return_points);
            };


            let last_colorscale;

            draw = function (return_points = false) {
              drawn.length = 0;

              // Collision detection for labels.
              const drawnLabels = quadtree()
                .x(d => d.x)
                .y(d => d.y);

              let max_text_width = 0;
              let max_text_height = 0;

              const labels_to_draw = [];


              if (colorize_by !== last_colorscale) {
                update_color_scale();
                last_colorscale = colorize_by;
              }

              if (top_n_filter) {
              // this is contingent on the visible screen area, so needs to be redone here.
                set_top_n_filter();
              }

              canvas.fill();
              canvas.textAlign = 'center';

              canvas.beginPath();


              let vals = visible_quadrants.values();

              /*
              function intize(quadname) {
              const a = quadname.split(',').map(d => +d);
              return 1e06 * a[0] + a[1] + a[2] / 1e06;
              }
            */

              vals = vals.sort();// (a, b) => intize(a) - intize(b));

              let max_r;
              if (typeof (size_goal) === 'function') {
                max_r = size_goal();
              } else {
                max_r = size_goal;
              }

              n_visible = 0;

              let regex_filter;

              if (select('#filter').node()) {
                regex_filter = select('#filter').node().value;
              } else {
                regex_filter = '';
              }
              const regex = new RegExp(regex_filter);

              canvas.globalAlpha = point_opacity;

              function plot_datum(d) {
                if (!is_visible(d)) {
                  return;
                }

                if (colorize_by) {
                  if (!d[colorize_by]) {
                    canvas.fillStyle = scheme === 'light' ?
                      'rgba(5,5,5,.4)' : 'rgba(250,250,250,.4)';
                  } else {
                    canvas.fillStyle = colors(d[colorize_by]);
                  }
                } else {
                  canvas.fillStyle = default_color;
                }

                n_visible += 1;

                let draw_as_point = true;

                if (d.zoom <= transform.k * point_threshold * label_threshold
                  && label_field
                  && d[label_field]
                  // No longer draw question marks if it has no label.
                ) {
                  draw_as_point = false;
                  if (variable_text_size) {
                    const relative_size = 1 / d.zoom;
                    const relative_zoom = transform.k * relative_size;
                    //                  var font_size = Math.pow(relative_zoom, 1.4);
                    var font_size = max([6 * max_r, Math.log(transform.k / d.zoom) * 6 * max_r]);
                  } else {
                    var font_size = 16;
                  }

                  const lab = d[label_field];

                  // Expensively measure width only once.
                  // Since the rect maintains the same dimensions, this can be cached for later use.

                  if (!d.Xwidths) {
                    d.Xwidths = {};
                  }
                  if (!d.Xwidths[font]) {
                    d.Xwidths[font] = {};
                  }

                  const buffer = scheme === 'streets' ? 0.2 * font_size : 0.02 * font_size;

                  if (!d.Xwidths[font][label_field]) {
                    canvas.font = `${font_style} ${font_size}px ${font}`;
                    d.Xwidths[font][label_field] = canvas.measureText(lab).width / font_size;
                  }

                  const width = font_size * d.Xwidths[font][label_field];
                  const corners = [d.cx - width / 2 - buffer * 5,
                    d.cx + width / 2 + buffer * 5,
                    d.cy - font_size - buffer / 4,
                    // Add a third of a letter for hanging 'y's and the like.
                    d.cy + font_size / 3 + buffer / 4];

                  if (width > max_text_width) {
                    max_text_width = width;
                  }

                  if (font_size > max_text_height) { max_text_height = font_size; }

                  drawnLabels.visit((node, x0, y0, x1, y1) => {
                    if (draw_as_point) { return true; }
                    if (node.length) {
                    // Check if we need to check children. Returning true means halt search.
                      return !hasOverlaps(
                        corners,
                        [x0 - max_text_width / 2,
                          x1 + max_text_width / 2,
                          y0 - max_text_height,
                          y1],
                      );
                    }
                    if (hasOverlaps(corners, node.data.corners)) {
                        if (collision_detection) {
                            draw_as_point = true;
                        }
                    }
                  });

                  // One can also add to the quadtree even if conflicted; this "reserves the spot" for
                  // later so there aren't dependency chains.
                  // Turns out that I prefer the higher density.
                    
                  if (!draw_as_point) {
                    drawnLabels.add({
                      x: d.cx, y: d.cy, corners, index: d.index,
                    });

                    labels_to_draw.push([lab, font_size, d, canvas.fillStyle, width, corners]);
                    draw_as_point = false;
                  }

                    
                }
                if (return_points) {
                    if (draw_as_point) {
                        drawn.point.push(d);
                    } else {
                        drawn.label.push(d);
                    }
                }

                if (draw_as_point) {
                  let r;
                  if (variable_point_size) {
                    r = min([max_r, Math.sqrt(transform.k / (d.zoom)) * max_r]);
                  } else {
                    r = max_r;
                  }

                  if (r > 1021.5) {
                    canvas.moveTo(d.cx, d.cy);
                    canvas.beginPath();
                    canvas.arc(d.cx, d.cy, r, 0, 2 * Math.PI);
                    canvas.closePath();
                    canvas.fill();
                  } else {
                    const rect_side = r * 1.77;
                    canvas.fillRect(d.cx - rect_side / 2, d.cy - rect_side / 2, rect_side * 3 / 4, rect_side * 4 / 3);
                  }
                }
              }

              vals.forEach((quadrant) => {
                const cached_tile = stored_tiles[quadrant];
                // If it's still downloading, don't plot this frame.

                if (debug === 'theoretical') {
                  sketch_visible_tiles();
                }

                if (cached_tile === 'fetching') { return; }
                if (!cached_tile) { return; }


                let any_plotted = false;
                stored_tiles[quadrant]
                  .data
                  .some((d) => {
                    if (d.zoom >= transform.k * point_threshold) {
                      return true;
                    }
                    any_plotted = true;
                    plot_datum(d);
                    return false;
                  });

                if (debug == 'actual' && any_plotted) {
                  sketch_visible_tiles();
                }

                function sketch_visible_tiles() {
                  const [rz, rx, ry] = quadrant.split(',');

                  if (+rx < 0 || +rx >= +rz || +ry < 0 || +ry >= +rz) {
                    return;
                  }

                  const hscale = scaleLinear()
                    .domain([0, rz])
                    .range(x_.domain());

                  const vscale = scaleLinear()
                    .domain([0, rz])
                    .range(y_.domain());

                  canvas.strokeStyle = 'rgba(128, 128, 128, .5)';
                  canvas.lineWidth = max([40 / rz * transform.k, 4]);
                  canvas.strokeRect(
                    x(hscale(rx)),
                    y(vscale(ry)),
                    x(hscale(1)) - x(hscale(0)),
                    y(vscale(1)) - y(vscale(0)),
                  );

                  let t;
                  if (debug === 'theoretical') {
                    t = Promise.resolve(quadrant);
                  } else {
                    t = tile_promises[quadrant].then(maxdepth => `${rx}, ${ry}|${rz}->${d3Format('.1f')(maxdepth)}`);
                  }

                  t.then((label) => {
                    canvas.fillStyle = 'rgba(128,128,128,1)';
                    const fill_size = min([max([64 * transform.k / (+rz), 10]), 64]);
                    canvas.font = `${font_style} ${fill_size}px ${font}`; 
                    canvas.fillText(label, x(hscale(+rx + 0.5)), 16 + y(vscale(+ry + 0.5)));
                  });
                }

                // Plot background rectangles

                if (scheme === 'light') {
                  canvas.fillStyle = 'rgba(255,255,255,.3)';
                } else if (scheme === 'dark') {
                  canvas.fillStyle = 'rgba(5,5,5,.3)';
                } else if (scheme === 'streets') {
                  canvas.fillStyle = 'default_color';
                }

                labels_to_draw.forEach((stored_point) => {
                  const [lab, font_size, d, style, width, corners] = stored_point;
                  const [u, i, o, p] = corners;
                  canvas.fillRect(u, o, i - u, p - o);
                });
              });

              // Plot labels.

              labels_to_draw.forEach((stored_point) => {
                const [lab, font_size, d, style, width] = stored_point;
                if (scheme == 'streets') {
                // Streets are always white.
                  canvas.fillStyle = 'rgba(250, 230, 240, 1)';
                } else {
                  canvas.fillStyle = style;
                }
                canvas.font = `${font_style} ${font_size}px ${font}`;
                canvas.fillText(lab, d.cx, d.cy);
              });

              const frac_visible = (transform.k * point_threshold) / (settings.max_zoom);

              const lab = d3Format(',')(n_visible);
              selectAll('#pointcount').text(lab);

              const dignow = Math.floor(Math.log10(n_visible));
              let lab2;
              if (frac_visible < 1) {
                let dignow = Math.floor(Math.log10(n_visible));

                if (dignow < 1) { dignow = 1; }

                lab2 = `~${d3Format(`,.${dignow}r`)(n_visible / frac_visible)}`;
              } else {
                lab2 = lab;
              }
              selectAll('#regioncount').text(lab2);
              if (return_points) {
                return drawn;
              }
            };

            let current;
            mouseQuadtreeSearch = function () {
              const event = mouse(this);
              const [xp, yp] = [event[0], event[1]];

              // Only highlight within 35 pixels
              let maximum_distance = x.invert(35) - x.invert(0);
              let closest = null;

              function draw_quad(quad_name) {
              // Search all the visible quadtrees for the point.
              // It may be just offscreen, alas.
              // Nonexistent tiles return nothing.
                if (!stored_tiles[quad_name]) { return false; }

                const zooml = quad_name.split(',')[0];


                const quadData = stored_tiles[quad_name].quadtree;
                // Empty tiles return nothing.
                if (!quadData) {
                  return false;
                }
                const point = quadData.find(
                  x.invert(xp),
                  y.invert(yp),
                  maximum_distance,
                  d => is_visible(d),
                );
                if (point) {
                  const dist = Math.sqrt(Math.pow(x.invert(xp) - point.x, 2) + Math.pow(y.invert(yp) - point.y, 2));
                  closest = point;
                  maximum_distance = dist;
                }
              }

              visible_quadrants
                .values()
                .forEach(draw_quad);


              if (closest === null) {
                point_layer.selectAll('rect').remove();
                current = 'nothing';
                return;
              }

              if (current !== closest.ix) {
                current = closest.ix;
                point_layer.selectAll('rect').remove();
                let circle = point_layer.selectAll('rect').data([closest]);

                const rw1 = 6;
                const rh1 = 4;
                const rw = 12;
                const rh = 18;

                const entering = circle
                  .enter()
                  .append('rect');

                circle = circle.merge(entering);

                circle
                  .style('stroke', 'none')
                  .attr('width', rw1)
                  .attr('height', rh1)
                  .style('opacity', 1)
                  .style('fill', d => colors(d[colorize_by]))
                  .style('fill-opacity', 1)
                  .attr('x', x(closest.x))
                  .attr('y', y(closest.y))
                  .attr('transform', `translate(-${rw1 / 2}, -${rh1 / 2})`)
                  .on('click', click_function)
                  .transition()
                  .duration(750)
                  .ease(easeCubicOut)
                  .attr('width', rw)
                  .attr('height', rh)
                  .attr('transform', `translate(-${rw / 2}, -${rh / 2})`);

                /*
                const html = function (d) {
                const rows =       .map(key => (d[key] ? `<span>${key}:</span> ` + `<span>${d[key]}</span>` : ''))


                return rows.join('<br>');
                };
              */

                selectAll('div.ttooltip').remove();

                const tip = select('body')
                  .append('div')
                  .attr('class', 'ttooltip');

                function make_click() {
                  click_function(closest);
                }

                const els = keys(closest)
                  .filter(key => ['x', 'y', 'lc0', 'lc1',
                    'zoom', 'genre', 'cx', 'cy',
                    'base_zoom', 'quadrant',
                    'dist', 'Xwidths', 'ix'].indexOf(key) === -1)
                  .filter(key => closest[key]);
                // Remove empty entries

                let card_els = tip.selectAll('div').data(els);

                card_els = card_els.merge(card_els
                  .enter().append('div')
                  .attr('class', 'metadata-item'));

                card_els.append('span').attr('class', 'metadata-label').text(d => d);
                card_els.append('span').attr('class', 'metadata-text').text(d => closest[d]);


                tip
                  .classed('visible', true)
                  .style('left', `${event[0] + 10}px`)
                  .style('top', `${event[1] + 5}px`)
                  .on('click', make_click)
                  .transition()
                  .duration(7000)
                  .on('end', () => tip.classed('visible', false));
              //                .end()
              //                .classed("visible", false)
              }
            }
              updateData();
          })
              

    return creationPromise;
  };


  that.load_preset_buttons = function () {
    const presets = that.add_card_section('Some interesting locations', '', 'presets');

    d3Fetch.tsv(`${base_dir}/presets.tsv`).then((dat) => {
      const buttons = presets.selectAll('a').data(dat);
      buttons.enter()
        .append('a')
        .attr('class', 'btn')
        .text(d => d.label)
        .on('click', (d) => {
          that.zoom_to(d.z, d.x, d.y);
        });
    });
    return that;
  };

  function updateBlock(jsonp) {
    // Hathi trust only.
    const floo = jsonp;
    var record = floo[keys(floo)[0]].records;
    var record = record[keys(record)[0]];
    tip.hide();
    tip.html(`${record.titles[0]}, ${record.publishDates[0]}`);
    tip.show(awooga.node());
  }

  that.plotAPI = function (calls = {}, plot = true) {
    // Kill any running animations.
    animation_timers.forEach(t => t.stop());
    animation_timers.length = 0;

    const creation = that.create(calls);

    return creation.then(() => {
      that.updateFromAPI(calls, plot);
      if (!plot) {
        return 1;
      }
      if (calls.zoom && calls.zoom !== 'undefined') {
        that.zoom_to.apply(null, calls.zoom);
      }
      that.redraw();
      return 1;
      // Stop any running animations.
    });
  };

  that.drawSVG = function (r = 2, shape = 'circle') {
      canvas.clearRect(0, 0, width, height);            
    const { point, label } = that.redraw(true);
      window.gah = point;
      
    const points = svg.selectAll(shape)
      .data(point, d => d.ix);

    points.exit().remove();

    const entrance = points.enter().append(shape);
    const circles = points.merge(entrance);
    circles
      .attr('cx', d => x(d.x))
      .attr('cy', d => y(d.y))
      .style('fill', d => colors(d[colorize_by]))
      .attr('r', r);

    const labs = svg.selectAll("text")
                   .data(label, d => d.ix);
      
    labs.exit().remove();

    const lentrance = labs.enter().append("text");
    const lcircles = labs.merge(lentrance);
    lcircles
      .attr('x', d => x(d.x))
      .attr('y', d => y(d.y))
      .style('fill', d => colors(d[colorize_by]))
      .text(d => d[label_field]);
    
  };

  return that;
}


function hasOverlaps(corners, compCorners) {
  // Do the ys first, because they're more likely to be false.
  return (corners[2] < compCorners[3] &&
            corners[3] > compCorners[2] &&
            corners[0] < compCorners[1] &&
            corners[1] > compCorners[0]);
}

function parseRow(d, rz, key) {
  d.base_zoom = rz;
  d.quadrant = key;

    if (d.ix == undefined) {
        d.ix = d.building
    }
  if (d.lc1) {
    d.Classification = d.lc1.substr(0, 1);
    d.Subclassification = d.lc1;
  }

  if (d.htid) {
    d.library = d.htid.split('.')[0];
  }

  if (d.id && (d.first_author_name || d.lc1 || d.language)) {
    // Must be Hathi.
    d.library = d.id.split('.')[0];
  }

  if (d.title && d.id) {
    const t = d.title;
    if (t.endsWith(' /')) {
      d.title = d.title.slice(0, -2);
    }
    d.genre =
        t.search(/[pP]oe(try|m)/) > -1 ?
          'Poetry' :
          t.search(/[Nn]ovel/) > -1 ?
            'Novel' :
            t.search(/[Pp]lay/) > -1 ?
              'Play' :
              undefined;
  }
  return d;
}
