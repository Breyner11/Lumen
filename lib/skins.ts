export const SKIN_IDS = [
  "brisa",
  "tinta",
  "solar",
  "noche",
  "coral",
  "bosque",
] as const;

export type SkinId = (typeof SKIN_IDS)[number];

export type Skin = {
  id: SkinId;
  name: string;
  blurb: string;
  swatches: [string, string, string];
};

/** Six distinct looks. Choosing one sets data-skin on <html>. */
export const SKINS: Skin[] = [
  {
    id: "brisa",
    name: "Brisa",
    blurb: "Azul claro, vidrio y acento teal.",
    swatches: ["#e8eef4", "#0f766e", "#0f172a"],
  },
  {
    id: "tinta",
    name: "Tinta",
    blurb: "Blanco nítido, negro y un verde vivo.",
    swatches: ["#f7f7f5", "#111111", "#16a34a"],
  },
  {
    id: "solar",
    name: "Solar",
    blurb: "Arena suave, oliva y tipografía redonda.",
    swatches: ["#f3ebe0", "#3f4a2f", "#c45c26"],
  },
  {
    id: "noche",
    name: "Noche",
    blurb: "Fondo oscuro, tipografía clara y cian.",
    swatches: ["#0b1220", "#22d3ee", "#e2e8f0"],
  },
  {
    id: "coral",
    name: "Coral",
    blurb: "Rosa suave, blanco y un coral calmado.",
    swatches: ["#fff5f3", "#e11d48", "#1f2937"],
  },
  {
    id: "bosque",
    name: "Bosque",
    blurb: "Verde musgo, crema de hoja y tipografía serif.",
    swatches: ["#edf2e8", "#1b4332", "#95d5b2"],
  },
];

export const SKIN_MAP = Object.fromEntries(SKINS.map((skin) => [skin.id, skin])) as Record<
  SkinId,
  Skin
>;

export function isSkinId(value: string): value is SkinId {
  return SKIN_IDS.includes(value as SkinId);
}
