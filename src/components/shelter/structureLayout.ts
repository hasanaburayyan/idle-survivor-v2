// Static floor-plan layout for The Shelter. Each structure has a fixed grid
// position. Adding a new structure = one entry here + its page component.
//
// Coordinates are 0-indexed cells on a small grid (column, row). The grid
// itself is rendered as a flex layout — coords are sort keys, not pixels.

export interface ShelterStructureLayout {
  structureId: string;
  /** Display-name override; falls back to structure_definition.name. */
  displayName?: string;
  /** Column on the floor-plan grid. */
  col: number;
  /** Row on the floor-plan grid. */
  row: number;
  /** Tailwind class for tile accent — matches each structure's vibe. */
  accent: string;
}

export const SHELTER_LAYOUT: ShelterStructureLayout[] = [
  { structureId: 'workbench',      col: 0, row: 0, accent: 'border-amber-700/60' },
  { structureId: 'refinery',       col: 1, row: 0, accent: 'border-cyan-700/60' },
  { structureId: 'smelter',        col: 2, row: 0, accent: 'border-orange-700/60' },
  { structureId: 'garden',         col: 0, row: 1, accent: 'border-emerald-700/60' },
  { structureId: 'armory',         col: 1, row: 1, accent: 'border-slate-600' },
  { structureId: 'class_crafting', col: 2, row: 1, accent: 'border-violet-700/60' },
];

// Order shown in the persistent structure bar. Mirrors the floor plan
// row-by-row.
export const STRUCTURE_BAR_ORDER: string[] = SHELTER_LAYOUT
  .slice()
  .sort((a, b) => a.row * 10 + a.col - (b.row * 10 + b.col))
  .map((s) => s.structureId);

// Construction-site activities shown on the floor plan when their target
// structure does not yet exist. Map: activityId → grid coords matching where
// the structure will appear once built.
export const CONSTRUCTION_SITE_LAYOUT: Record<string, { col: number; row: number }> = {
  build_workbench: { col: 0, row: 0 },
  build_refinery:  { col: 1, row: 0 },
  build_smelter:   { col: 2, row: 0 },
  build_garden:    { col: 0, row: 1 },
  build_armory:    { col: 1, row: 1 },
};

export function findStructureLayout(structureId: string): ShelterStructureLayout | undefined {
  return SHELTER_LAYOUT.find((s) => s.structureId === structureId);
}
