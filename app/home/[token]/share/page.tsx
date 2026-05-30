import Link from "next/link";
import { fetchOwnerStoryByToken } from "@/lib/data/owner-story-db";
import SellerCaptureForm from "@/components/SellerCaptureForm";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata() {
  return { title: "Share the Owner Story", robots: { index: false } };
}

/**
 * Public, token-gated capture page reached from the agent's Monday email
 * ("set your seller up to get it automatically"). The agent enters their
 * seller's name(s) + email; the form POSTs to /api/owner-story/[token]/share.
 */
export default async function ShareOwnerStoryPage({ params }: PageProps) {
  const { token } = await params;
  const story = await fetchOwnerStoryByToken(token);

  if (!story) {
    return (
      <main className="mx-auto max-w-lg px-5 py-16 text-center">
        <h1 className="text-xl font-semibold text-neutral-900">
          Link not found
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          This Owner Story link isn&apos;t valid. Check the link in your email
          and try again.
        </p>
      </main>
    );
  }

  const address = story.listing.address ?? "your listing";
  const locationLine = story.listing.city
    ? `${address}, ${story.listing.city}`
    : address;

  return (
    <main className="mx-auto max-w-lg px-5 py-10">
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        {story.listing.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={story.listing.hero_image_url}
            alt={address}
            className="h-44 w-full object-cover"
          />
        ) : null}
        <div className="p-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold-600">
            Send to your seller
          </div>
          <h1 className="mt-1 text-xl font-bold leading-tight text-neutral-900">
            {locationLine}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-neutral-600">
            Add your seller below and we&apos;ll send them the live Owner Story
            for their home right now — then automatically every Monday so they
            can watch the exposure build. You can also just{" "}
            <Link
              href={`/home/${token}`}
              className="text-gold-700 underline hover:text-gold-800"
            >
              open the page
            </Link>{" "}
            and forward the link yourself by text or email.
          </p>

          <div className="mt-6">
            <SellerCaptureForm token={token} address={address} />
          </div>
        </div>
      </div>
    </main>
  );
}
