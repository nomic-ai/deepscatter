<script>
  import { Scatterplot } from '../src/deepscatter';
  const prefs = {
    source_url: '/tiles',
    max_points: 1000000, // a full cap.
    alpha: 35, // Target saturation for the full page.
    zoom_balance: 0.22, // Rate at which points increase size. https://observablehq.com/@bmschmidt/zoom-strategies-for-huge-scatterplots-with-three-js
    point_size: 2, // Default point size before application of size scaling
    background_color: '#EEEDDE',
    encoding: {
      /**
      Note--if you do not have a field called 'class' in your dataset, this will fail!
      */
      color: {
        field: 'class',
        range: 'category10',
      },
      x: {
        field: 'x',
        transform: 'literal',
      },
      y: {
        field: 'y',
        transform: 'literal',
      },
    },
  };
  //list of ids 1 - 100000
  var ids_1 = [];
  var ids_2 = [];
  for (var i = 1; i < 500000; i++) {
    ids_1.push(i.toString());
  }

  //list of ids 1 - 20000 increment by 2
  for (var i = 1; i < 20000; i++) {
    ids_2.push(i.toString());
  }
  const colors = [
    //    JSON.parse(JSON.stringify(prefs.encoding.color)),
    {
      field: 'quantity',
      range: 'ylorrd',
      domain: [0, 1]
    },
  ];

  const scatterplot = new Scatterplot('#deepscatter');
  window.scatterplot = scatterplot;
  scatterplot.plotAPI(prefs).then((d) => scatterplot.plotAPI(prefs));
  window.plot = scatterplot; // For debugging
  // Simple animation demonstration.

  // In practice, you might transform an external annotations layer using this
  scatterplot.on_zoom = (transform) => console.log('zoomed:', transform);

  let cycle = 0;
  select('#jitter').on('change', (event) => {
    scatterplot.plotAPI({
      encoding: {
        jitter_radius: {
          method: 'uniform',
          constant: +event.target.value,
        },
      },
    });
  });
  select('#html').on('click', () => {
    scatterplot.tooltip_html = (datum) => {
      return `This is point number <span style="color:blue">${datum.ix}</span>`;
    };
  });
  const positions = [
    {
      field: 'x',
      transform: 'literal',
    },
    {
      field: 'y',
      transform: 'literal',
    },
  ];
  select('#flip').on('click', () => {
    cycle += 1;
    const new_coding = {
      encoding: {
        color: colors[cycle % colors.length],
        x: positions[cycle % positions.length],
        y: positions[(cycle + 1) % positions.length],
      },
    };
    scatterplot.plotAPI(new_coding);
  });
</script>

<style>
dt {
  float: left;
  clear: left;
  width: 90px;
  font-weight: bold;
  color: rg#80130054
}

dt::after {
  content: ':';
}

dd {
  margin: 0 0 0 80px;
  padding: 0 0 0.5em 0;
  width: 180px;
}
  .ttooltip {
  z-index: 99;
}
</style>