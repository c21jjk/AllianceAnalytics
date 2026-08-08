/**
 * DEPRECATED SHIM — 2026-08-08.
 *
 * This component became `FinalReviewStage`, which now serves every post type
 * rather than only multi-property Open House carousels. See that file's header
 * for why one shared component beat two lookalike screens.
 *
 * Kept only so any straggling import keeps compiling. Nothing in the app
 * imports this path any more, so it is safe to delete in GitHub Desktop.
 */
export { default } from "./FinalReviewStage";
export type {
  FinalReviewMode,
  FinalReviewStageProps,
} from "./FinalReviewStage";
