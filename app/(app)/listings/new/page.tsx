import { redirect } from "next/navigation";

/**
 * Legacy redirect — manual property entry now lives at /properties/new.
 */
export default function NewListingRedirectPage() {
  redirect("/properties/new");
}
