/**
 * Deprecated shim: the single-post drawer body was replaced by the
 * group-aware `<GroupDetailBody />` so a merged IG+TT campaign no longer
 * loses one platform's data. This re-export keeps any stragglers compiling.
 *
 * Remove once we've confirmed no remaining importers.
 */
export { default } from "./GroupDetailBody";
