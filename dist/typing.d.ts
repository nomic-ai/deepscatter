import type { RootChannel, OpChannel, ColorChannel, ConstantChannel, LambdaChannel, Labelcall, URLLabels, Labelset } from './shared.d';
export declare function isOpChannel(input: RootChannel): input is OpChannel;
export declare function isLambdaChannel(input: RootChannel): input is LambdaChannel;
export declare function isConstantChannel(input: RootChannel | ColorChannel): input is ConstantChannel;
export declare function isURLLabels(labels: Labelcall): labels is URLLabels;
export declare function isLabelset(labels: Labelcall): labels is Labelset;
//# sourceMappingURL=typing.d.ts.map