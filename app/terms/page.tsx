/**
 * Public Terms of Service. Required by Meta App Review for the Basic
 * Settings "Terms of Service URL" field. Reachable without auth via
 * PUBLIC_PATHS in lib/supabase/middleware.ts.
 */
export const metadata = {
  title: "Terms of Service — Alliance Social Analytics",
  description:
    "Terms of service for Alliance Social Analytics, an internal social-media management application used by Century 21 Alliance New Jersey.",
};

export const dynamic = "force-static";

const LAST_UPDATED = "May 16, 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-neutral-900">
      <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-neutral-500">Last updated: {LAST_UPDATED}</p>

      <section className="mt-8 space-y-4 text-sm leading-relaxed">
        <p>
          These Terms of Service (the &ldquo;Terms&rdquo;) govern access to and
          use of Alliance Social Analytics (the &ldquo;Service&rdquo;), an
          internal social-media management application operated by Century 21
          Alliance New Jersey (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;).
          By accessing the Service, you (&ldquo;User&rdquo;) agree to these
          Terms.
        </p>

        <h2 className="text-xl font-semibold pt-6">1. Eligibility and access</h2>
        <p>
          The Service is provided for the exclusive use of authorized
          employees and contractors of Century 21 Alliance New Jersey. Access
          is granted by an administrator and may be revoked at any time, with
          or without notice, for any reason or no reason. The Service is not
          available to the general public.
        </p>

        <h2 className="text-xl font-semibold pt-6">2. Acceptable use</h2>
        <p>You agree to use the Service only for legitimate marketing and
          operational purposes of Century 21 Alliance New Jersey. You agree
          NOT to:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Publish unlawful, defamatory, discriminatory, or harassing content.</li>
          <li>
            Violate the terms of service of any connected third-party platform
            (Meta, Instagram, TikTok).
          </li>
          <li>
            Misrepresent the firm, its agents, or any listed property in a way
            that violates real-estate marketing regulations.
          </li>
          <li>
            Attempt to access or modify other users&apos; accounts or data
            without authorization.
          </li>
          <li>
            Use the Service to scrape, harvest, or aggregate data from
            third-party platforms beyond what the Service&apos;s sanctioned
            features expose.
          </li>
        </ul>

        <h2 className="text-xl font-semibold pt-6">3. Real-estate content</h2>
        <p>
          You are responsible for the accuracy of listing data, captions,
          hashtags, and any other content you publish through the Service.
          Real-estate marketing is regulated; you agree to comply with all
          applicable Federal, State, and local laws, including the Fair
          Housing Act and the New Jersey Real Estate Commission&apos;s
          advertising regulations.
        </p>

        <h2 className="text-xl font-semibold pt-6">4. Third-party platforms</h2>
        <p>
          When you publish content through the Service to Facebook, Instagram,
          or TikTok, that content becomes subject to those platforms&apos;
          terms of service and content policies. The Service has no control
          over how those platforms display, moderate, or remove published
          content.
        </p>

        <h2 className="text-xl font-semibold pt-6">5. Intellectual property</h2>
        <p>
          The Service, its design, code, and documentation are the property
          of Century 21 Alliance New Jersey. Listing data is licensed from the
          applicable MLS feeds (Cape May County and South Jersey Shore
          Regional MLS). Brand assets (Century 21 marks) are the property of
          Century 21 Real Estate LLC and used under license.
        </p>

        <h2 className="text-xl font-semibold pt-6">6. Disclaimer of warranties</h2>
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo; without warranties of any kind, express or implied.
          We do not warrant that the Service will be uninterrupted, error-free,
          or that publish requests will always succeed (downstream platform
          APIs may rate-limit, deprecate features, or reject content for
          reasons outside our control).
        </p>

        <h2 className="text-xl font-semibold pt-6">7. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Century 21 Alliance New
          Jersey shall not be liable for any indirect, incidental,
          consequential, or punitive damages arising from your use of the
          Service, including but not limited to lost marketing opportunities,
          missed posts, or platform suspensions.
        </p>

        <h2 className="text-xl font-semibold pt-6">8. Changes to these Terms</h2>
        <p>
          We may update these Terms from time to time. The &ldquo;Last
          updated&rdquo; date at the top of this page reflects the most recent
          revision. Continued use of the Service after a revision constitutes
          acceptance of the updated Terms.
        </p>

        <h2 className="text-xl font-semibold pt-6">9. Contact</h2>
        <p>
          Questions about these Terms can be sent to:
        </p>
        <p>
          <strong>Century 21 Alliance New Jersey</strong>
          <br />
          Email:{" "}
          <a href="mailto:legal@c21anj.com" className="underline">
            legal@c21anj.com
          </a>
        </p>
      </section>
    </main>
  );
}
