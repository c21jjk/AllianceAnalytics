"use client";

/**
 * Placeholder insertion — Template Builder authoring helper.
 * ----------------------------------------------------------
 *
 * Builds Fabric objects for a bound-field placeholder that the author drops
 * onto the canvas while designing a template. Each object is stamped with:
 *   • the standard layer-data bag (layerId / layerKind / displayName), and
 *   • the placeholder `boundField` (via setLayerBoundField),
 * so the save path (reconstruct-schema) round-trips it as a real bound layer
 * that re-resolves against the live listing on every post.
 *
 * Text placeholders are a Textbox whose content is the field's friendly
 * label (the fallback shown when the bound value is empty). Image
 * placeholders are a dashed gold frame — a rounded Rect (a full-radius
 * "circle" for agent headshots) carrying layerKind="image" — because there's
 * no photo to show until a post is generated. The frame's box size + corner
 * radius are stamped so the saved ImageLayer keeps its shape.
 *
 * Authoring-only: the Placeholders panel that calls this is gated to Template
 * Builder (templateAuthoring mode). Larissa's post-building Studio never sees
 * it — she fills real data, she doesn't bind fields.
 */

import { Rect, Textbox, type FabricObject } from "fabric";

import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "./templates/tokens";
import { setLayerData, setLayerBoundField } from "./fabric-factory";
import type { BoundField, ImageBoundField } from "./types";

export type PlaceholderKind = "text" | "image";

export interface PlaceholderField {
  field: BoundField;
  label: string;
  kind: PlaceholderKind;
}

export interface PlaceholderGroup {
  group: string;
  fields: readonly PlaceholderField[];
}

/**
 * Curated catalog of bound fields offered in the Placeholders panel, grouped
 * for scanability. Mirrors the TextBoundField / ImageBoundField unions in
 * types.ts — keep in sync when a new bound field is added there.
 */
export const PLACEHOLDER_GROUPS: readonly PlaceholderGroup[] = [
  {
    group: "Listing",
    fields: [
      { field: "status_label", label: "Status Label", kind: "text" },
      { field: "price", label: "Price", kind: "text" },
      { field: "close_price", label: "Sold Price", kind: "text" },
      { field: "address_line1", label: "Street Address", kind: "text" },
      { field: "city_state_zip", label: "City, State ZIP", kind: "text" },
      { field: "beds_baths", label: "Beds / Baths", kind: "text" },
      { field: "property_type", label: "Property Type", kind: "text" },
      { field: "mls_number", label: "MLS #", kind: "text" },
      { field: "tagline", label: "Tagline", kind: "text" },
    ],
  },
  {
    group: "Photos",
    fields: [
      { field: "hero_photo", label: "Hero Photo", kind: "image" },
      { field: "photo_2", label: "Photo 2", kind: "image" },
      { field: "photo_3", label: "Photo 3", kind: "image" },
      { field: "photo_4", label: "Photo 4", kind: "image" },
      { field: "photo_5", label: "Photo 5", kind: "image" },
    ],
  },
  {
    group: "Agent",
    fields: [
      { field: "agent_photo", label: "Agent Photo", kind: "image" },
      { field: "agent_name", label: "Agent Name", kind: "text" },
      { field: "agent_title", label: "Agent Title", kind: "text" },
      { field: "agent_phone", label: "Agent Phone", kind: "text" },
      { field: "agent_email", label: "Agent Email", kind: "text" },
    ],
  },
  {
    group: "Open House",
    fields: [
      { field: "open_house_date", label: "Open House Date", kind: "text" },
      { field: "open_house_time", label: "Open House Time", kind: "text" },
      { field: "hosting_agent_photo", label: "Hosting Agent Photo", kind: "image" },
      { field: "hosting_agent_name", label: "Hosting Agent Name", kind: "text" },
      { field: "hosting_agent_phone", label: "Hosting Agent Phone", kind: "text" },
    ],
  },
  {
    group: "Office & Brand",
    fields: [
      { field: "office_name", label: "Office Name", kind: "text" },
      { field: "office_logo", label: "Office Logo", kind: "image" },
      { field: "brokerage_logo", label: "Brokerage Logo", kind: "image" },
    ],
  },
];

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

const CIRCULAR_IMAGE_FIELDS = new Set<ImageBoundField>([
  "agent_photo",
  "hosting_agent_photo",
]);

/**
 * Build (but do not add) the Fabric object for a placeholder. The caller adds
 * it to the canvas, selects it, bumps layer version, and records history —
 * mirroring the brand-asset drop flow.
 */
export function buildPlaceholderObject(
  field: PlaceholderField,
  canvasWidth: number,
  canvasHeight: number,
): FabricObject {
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  if (field.kind === "text") {
    const tb = new Textbox(field.label, {
      left: cx,
      top: cy,
      width: Math.min(560, canvasWidth - 160),
      originX: "center",
      originY: "center",
      fontFamily: ALLIANCE_FONTS.bodySans,
      fontSize: 48,
      fontWeight: 600,
      fill: ALLIANCE_COLORS.ink900,
      textAlign: "center",
      editable: true,
      selectable: true,
      evented: true,
      cornerStyle: "circle",
      cornerSize: 10,
      transparentCorners: false,
      borderColor: ALLIANCE_COLORS.gold500,
      cornerColor: ALLIANCE_COLORS.gold500,
      padding: 2,
    });
    setLayerData(tb, {
      layerId: makeId("ph_text"),
      layerKind: "text",
      displayName: field.label,
    });
    setLayerBoundField(tb, field.field);
    return tb;
  }

  // Image placeholder — a dashed gold frame. Agent / hosting-agent headshots
  // use a full-radius circle (the C21 convention); everything else a
  // rounded rectangle.
  const isCircle = CIRCULAR_IMAGE_FIELDS.has(field.field as ImageBoundField);
  const size = isCircle
    ? Math.min(360, canvasWidth * 0.35)
    : Math.min(560, canvasWidth * 0.6);
  const radius = isCircle ? size / 2 : 18;

  const rect = new Rect({
    left: cx,
    top: cy,
    width: size,
    height: size,
    originX: "center",
    originY: "center",
    fill: "rgba(201,168,76,0.12)",
    stroke: ALLIANCE_COLORS.gold500,
    strokeWidth: 3,
    strokeDashArray: [10, 8],
    rx: radius,
    ry: radius,
    selectable: true,
    evented: true,
    cornerStyle: "circle",
    cornerSize: 10,
    transparentCorners: false,
    borderColor: ALLIANCE_COLORS.gold500,
    cornerColor: ALLIANCE_COLORS.gold500,
  });
  setLayerData(rect, {
    layerId: makeId("ph_img"),
    // why: layerKind MUST be "image" so reconstruct-schema saves it as an
    // ImageLayer (not a shape) that the render pipeline hydrates from the
    // bound photo. It's authored as a Rect only because there's no image to
    // show yet.
    layerKind: "image",
    displayName: field.label,
    targetBoxWidth: size,
    targetBoxHeight: size,
    cornerRadius: radius,
    objectFit: "cover",
  });
  setLayerBoundField(rect, field.field, false);
  return rect;
}
