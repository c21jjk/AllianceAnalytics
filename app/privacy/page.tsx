/**
 * Public privacy policy. Required by Meta App Review and TikTok Developer
 * App registration. Reachable without auth via PUBLIC_PATHS in
 * lib/supabase/middleware.ts.
 *
 * Style note: deliberately plain HTML (no shared layout chrome) so the
 * policy reads as a standalone legal document and Meta's reviewer can
 * paste the URL anywhere without auth or design dependencies.
 */
export const metadata = {
  title: "Privacy Policy — Alliance Social Analytics",
  description:
    "Privacy policy for Alliance Social Analytics, an internal social-media management application used by Century 21 Alliance New Jersey.",
};

export const dynamic = "force-static";

const LAST_UPDATED = "May 16, 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-neutral-900">
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-neutral-500">Last updated: {LAST_UPDATED}</p>

      <section className="mt-8 space-y-4 text-sm leading-relaxed">
        <p>
          Alliance Social Analytics (the &ldquo;Service&rdquo;) is an internal
          social-media management application used by Century 21 Alliance New
          Jersey (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) and
          its authorized employees. The Service helps the firm publish branded
          real-estate marketing content to its own social-media accounts
          (Facebook Page, Instagram Business account, and TikTok account).
        </p>
        <p>
          The Service is not offered to the public. Account creation is
          restricted to designated employees of Century 21 Alliance New Jersey.
          This Privacy Policy explains the data we collect, how we use it, and
          the rights of the limited group of authorized users.
        </p>

        <h2 className="text-xl font-semibold pt-6">1. Data we collect</h2>
        <p>The Service collects and stores the following data:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            <strong>Authorized user account data</strong> — name, email address,
            role, and authentication credentials for employees granted access
            to the Service. Authentication is handled by Supabase Auth.
          </li>
          <li>
            <strong>Real-estate listing data</strong> — publicly available MLS
            listing fields (address, price, photos, etc.) for properties that
            our firm represents. Sourced from Paragon RETS feeds licensed by
            Century 21 Alliance.
          </li>
          <li>
            <strong>Social-media account data</strong> — access tokens, account
            identifiers, and post performance metrics for the firm&apos;s own
            Facebook Page, Instagram Business account, and TikTok account.
            Access tokens are encrypted at rest in our database.
          </li>
          <li>
            <strong>Generated post content</strong> — designed images, captions,
            hashtags, and publication metadata for posts created within the
            Service.
          </li>
          <li>
            <strong>Audit and operational logs</strong> — timestamps, IDs, and
            error messages for publish attempts and other operations performed
            within the Service, for debugging and accountability.
          </li>
        </ul>
        <p>
          The Service does <strong>not</strong> collect end-consumer data,
          follower lists, or any personal data of social-media users who
          interact with our published content.
        </p>

        <h2 className="text-xl font-semibold pt-6">2. How we use data</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>To authenticate authorized employees signing into the Service.</li>
          <li>
            To compose and publish marketing posts to our firm&apos;s own
            social-media accounts.
          </li>
          <li>
            To display analytics (post performance, listing engagement) to our
            firm&apos;s marketing and management staff.
          </li>
          <li>To operate, debug, and improve the Service.</li>
        </ul>
        <p>
          We do not sell, rent, or share authorized-user data or post content
          with third parties for marketing or advertising purposes.
        </p>

        <h2 className="text-xl font-semibold pt-6">3. Third-party services</h2>
        <p>The Service relies on the following third-party providers:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            <strong>Meta Platforms, Inc.</strong> — Facebook Graph API and
            Instagram Content Publishing API. Governed by the Meta Platform
            Terms and Meta Developer Policies.
          </li>
          <li>
            <strong>TikTok</strong> — Content Posting API. Governed by the
            TikTok for Developers Terms of Service.
          </li>
          <li>
            <strong>Supabase Inc.</strong> — database, authentication, and
            file storage. Governed by Supabase&apos;s Privacy Policy.
          </li>
          <li>
            <strong>Vercel Inc.</strong> — application hosting. Governed by
            Vercel&apos;s Privacy Policy.
          </li>
          <li>
            <strong>Anthropic, PBC</strong> — Claude API for generative AI
            features (caption drafting, content suggestions). Governed by
            Anthropic&apos;s Privacy Policy.
          </li>
        </ul>

        <h2 className="text-xl font-semibold pt-6">4. Data retention</h2>
        <p>
          Authorized-user data, listing data, and post content are retained for
          as long as the user remains authorized and the post remains
          operationally useful. Operational logs are retained for up to 12
          months. Access tokens are rotated or revoked when an employee leaves
          the firm or a social-media account is disconnected.
        </p>

        <h2 className="text-xl font-semibold pt-6">5. Data deletion</h2>
        <p>
          An authorized user may request deletion of their account and
          associated data by emailing the address below. Requests are honored
          within 30 days. Note: published social-media posts created within
          the Service remain on the social-media platforms where they were
          published, subject to those platforms&apos; own retention and
          deletion policies.
        </p>

        <h2 className="text-xl font-semibold pt-6">6. Security</h2>
        <p>
          Access tokens are encrypted at rest. The Service is hosted behind
          industry-standard TLS. Authorized users authenticate via Supabase
          Auth with email + password. Access to administrative endpoints
          requires an &ldquo;admin&rdquo; role explicitly granted by the firm.
        </p>

        <h2 className="text-xl font-semibold pt-6">7. Children&apos;s data</h2>
        <p>
          The Service is not directed to children under 13 and we do not
          knowingly collect data from anyone under 13.
        </p>

        <h2 className="text-xl font-semibold pt-6">8. Changes to this policy</h2>
        <p>
          We may update this Privacy Policy from time to time. The
          &ldquo;Last updated&rdquo; date at the top of this page reflects the
          most recent revision.
        </p>

        <h2 className="text-xl font-semibold pt-6">9. Contact</h2>
        <p>
          Questions about this Privacy Policy or requests for data deletion
          can be sent to:
        </p>
        <p>
          <strong>Century 21 Alliance New Jersey</strong>
          <br />
          Email:{" "}
          <a href="mailto:privacy@c21anj.com" className="underline">
            privacy@c21anj.com
          </a>
        </p>
      </section>
    </main>
  );
}
