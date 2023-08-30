import { ScaleLinear } from 'd3-scale';
import type { Renderer } from './rendering';
import { StructRowProxy } from 'apache-arrow';
import { Rectangle } from './tile';
import type { Dataset } from './Dataset';
import type * as DS from './shared';
export default class Zoom<T extends DS.Tile> {
    prefs: DS.APICall;
    svg_element_selection: d3.Selection<d3.ContainerElement, Record<string, any>, any, any>;
    width: number;
    height: number;
    renderers: Map<string, Renderer<T>>;
    tileSet?: Dataset<T>;
    _timer?: d3.Timer;
    _scales?: Record<string, d3.ScaleLinear<number, number>>;
    zoomer?: d3.ZoomBehavior<Element, unknown>;
    transform?: d3.ZoomTransform;
    _start?: number;
    scatterplot: DS.Plot;
    constructor(selector: string, prefs: DS.APICall, plot: DS.Plot);
    attach_tiles(tiles: Dataset<T>): this;
    attach_renderer(key: string, renderer: Renderer<T>): this;
    zoom_to(k: number, x: number, y: number, duration?: number): void;
    html_annotation(points: Array<Record<string, string | number>>): void;
    zoom_to_bbox(corners: Rectangle, duration?: number, buffer?: number): void;
    initialize_zoom(): void;
    set_highlit_points(data: StructRowProxy[]): void;
    set_highlit_point(point: StructRowProxy): void;
    add_mouseover(): void;
    current_corners(): Rectangle | undefined;
    current_center(): number[];
    restart_timer(run_at_least?: number): import("d3-timer").Timer;
    data(dataset: any): this | Dataset<T>;
    scales(equal_units?: boolean): Record<string, ScaleLinear<number, number>>;
    webgl_scale(flatten?: boolean): number[];
    tick(force?: boolean): void;
}
export declare function window_transform(x_scale: ScaleLinear<number, number, never>, y_scale: ScaleLinear<number, number, never>): number[][];
//# sourceMappingURL=interaction.d.ts.map