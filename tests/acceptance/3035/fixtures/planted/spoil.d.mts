// The types of spoil.mjs, the three wrong conversions issue #3035's criteria name (README: The planted programs).
export type PlantedName = 'flips_one_joint_axis' | 'copies_poses_as_written' | 'drops_one_silently';
export interface Outputs { document: string; report: string }
export declare const PLANTED: PlantedName[];
export declare const FLIPPED: 'elbow';
export declare const MOVED: 'mast';
export declare const UNLISTED: 'transmission';
export declare function spoil(name: string, outputs: Outputs): Outputs;
