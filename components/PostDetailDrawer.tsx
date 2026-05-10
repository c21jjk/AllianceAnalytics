/**
 * Deprecated shim: the post-detail drawer was generalized into
 * `<DetailDrawer>` in `./DetailDrawer.tsx`. This file re-exports it so any
 * stragglers still importing the old name keep compiling.
 *
 * Remove this shim once we've confirmed no remaining importers.
 */
export { default } from "./DetailDrawer";
