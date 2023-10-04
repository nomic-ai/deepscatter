import { Dictionary, Utf8, Int8, Int16, Int32 } from "apache-arrow";
declare type IndicesType = null | Int8Array | Int16Array | Int32Array;
declare type DictionaryType = Dictionary<Utf8, Int8 | Int16 | Int32>;
export declare function dictionaryFromArrays(labels: string[]): (indices: IndicesType) => DictionaryType;
export declare function dictionaryFromArrays(labels: string[], indices: IndicesType): DictionaryType;
export {};
//# sourceMappingURL=utilityFunctions.d.ts.map