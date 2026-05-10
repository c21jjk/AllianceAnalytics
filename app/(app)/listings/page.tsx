import { redirect } from "next/navigation";

/**
 * Legacy redirect: the standalone Listings tab was consolidated into
 * /properties. Manual property add/edit lives at /properties/new and
 * /properties/[mls]/edit (with drawer overlays when navigated to from inside
 * the app shell).
 *
 * The actions still live in `./actions.ts` — that file is kept as the home
 * for createListingAction / updateListingAction / classifyPostAction /
 * setPostMlsNumber, even though no URL is exposed at /listings anymore.
 */
export default function ListingsRedirectPage() {
  redirect("/properties");
}
