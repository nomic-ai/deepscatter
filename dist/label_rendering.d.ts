import type { GeoJsonObject, GeoJsonProperties } from 'geojson';
import { Renderer } from './rendering';
import { RBush3D } from 'rbush-3d';
import Scatterplot from './deepscatter';
import { Timer } from 'd3-timer';
import type { Tile } from './tile';
import type * as DS from './shared';
export declare class LabelMaker<T extends Tile> extends Renderer<T> {
    /**
     * A LabelMaker
     */
    layers: GeoJsonObject[];
    ctx: CanvasRenderingContext2D;
    tree: DepthTree;
    timer?: Timer;
    label_key?: string;
    labelgroup: SVGGElement;
    private hovered;
    options: DS.LabelOptions;
    /**
     *
     * @param scatterplot
     * @param id_raw
     * @param options
     */
    constructor(scatterplot: Scatterplot<DS.TileType>, id_raw: string, options?: DS.LabelOptions);
    /**
     * Start rendering a set of labels.
     *
     * @param ticks How many milliseconds until the renderer should be stopped.
     */
    start(ticks?: number): void;
    delete(): void;
    /**
     * Stop the rendering of this set.
     */
    stop(): void;
    /**
     *
     * @param featureset A feature collection of labels to display. Currently each feature must be a Point.
     * @param label_key The field in each geojson feature that includes the label for the object.
     * @param size_key The field in each geojson feature that includes the size
     */
    update(featureset: GeoJSON.FeatureCollection, label_key: string, size_key: string | undefined): void;
    render(): void;
}
declare type RawPoint = {
    x: number;
    y: number;
    text: string;
    height: number;
    properties?: GeoJsonProperties;
};
export declare type Point = RawPoint & {
    pixel_width: number;
    pixel_height: number;
};
export declare type P3d = {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
    data: Point;
};
declare class DepthTree extends RBush3D {
    scale_factor: number;
    mindepth: number;
    maxdepth: number;
    context: CanvasRenderingContext2D;
    pixel_ratio: number;
    rectangle_buffer: number;
    margin: number;
    private _accessor;
    constructor(context: CanvasRenderingContext2D, pixel_ratio: number, scale_factor?: number, zoom?: number[], margin?: number);
    /**
     *
     * @param p1 a point
     * @param p2 another point
     * @returns The lowest zoom level at which the two points collide
     */
    max_collision_depth(p1: Point, p2: Point): number;
    set accessor(f: (p: Point) => [number, number]);
    get accessor(): (p: Point) => [number, number];
    to3d(point: Point, zoom: number, maxZ: number | undefined): P3d;
    insert_point(point: RawPoint | Point, mindepth?: number): void;
    insert_after_collisions(p3d: P3d): void;
}
export {};
//# sourceMappingURL=label_rendering.d.ts.map