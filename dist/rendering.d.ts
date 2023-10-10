import type Scatterplot from './deepscatter';
import type { Tile } from './tile';
import type Zoom from './interaction';
import type { AestheticSet } from './AestheticSet';
import { Timer } from 'd3-timer';
import { Dataset } from './Dataset';
import type * as DS from './shared.d';
import { Table } from 'apache-arrow';
declare class PlotSetting {
    start: number;
    value: number;
    target: number;
    timer: Timer | undefined;
    transform: 'geometric' | 'arithmetic';
    constructor(start: number, transform?: 'geometric' | 'arithmetic');
    update(value: number, duration: number): void;
    start_timer(duration: number): void;
}
declare class RenderProps {
    maxPoints: PlotSetting;
    targetOpacity: PlotSetting;
    pointSize: PlotSetting;
    foregroundOpacity: PlotSetting;
    backgroundOpacity: PlotSetting;
    foregroundSize: PlotSetting;
    backgroundSize: PlotSetting;
    constructor();
    apply_prefs(prefs: DS.CompletePrefs): void;
    get max_points(): number;
    get alpha(): number;
    get point_size(): number;
    get foreground_opacity(): number;
    get background_opacity(): number;
    get foreground_size(): number;
    get background_size(): number;
}
export declare class Renderer<TileType extends Tile> {
    scatterplot: Scatterplot<TileType>;
    holder: d3.Selection<any, any, any, any>;
    canvas: HTMLCanvasElement;
    dataset: Dataset<TileType>;
    width: number;
    height: number;
    deferred_functions: Array<() => Promise<void> | void>;
    _use_scale_to_download_tiles: boolean;
    zoom?: Zoom<TileType>;
    aes?: AestheticSet<TileType>;
    _zoom?: Zoom<TileType>;
    _initializations: Promise<void>[];
    render_props: RenderProps;
    constructor(selector: string, tileSet: Dataset<TileType>, scatterplot: Scatterplot<TileType>);
    get discard_share(): number;
    /**
     * Render prefs are scatterplot prefs, but for a single tile
     * instead of for a whole table.
     */
    get prefs(): DS.APICall & {
        background_options: {
            color: string;
            opacity: [number, number];
            size: [number, number];
            mouseover: boolean;
        };
        alpha: number;
        point_size: number;
        duration: number;
        zoom_balance: number;
        max_points: number;
    } & {
        arrow_table?: Table;
        arrow_buffer?: Uint8Array;
    };
    get alpha(): number;
    get optimal_alpha(): number;
    get point_size(): number;
    get max_ix(): number;
    visible_tiles(): Array<TileType>;
    bind_zoom(zoom: Zoom): this;
    initialize(): Promise<void>;
}
export {};
//# sourceMappingURL=rendering.d.ts.map