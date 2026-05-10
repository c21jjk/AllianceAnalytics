"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { Listing } from "@/lib/listings";

interface ActionState {
  ok: boolean;
  error?: string;
}

interface Props {
  mode: "create" | "edit";
  initial?: Partial<Listing>;
  action: (
    prev: ActionState | null,
    form: FormData,
  ) => Promise<ActionState>;
  /** Where the Cancel button goes. Defaults to /properties (the index page). */
  cancelHref?: string;
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "sold", label: "Sold" },
  { value: "expired", label: "Expired" },
  { value: "withdrawn", label: "Withdrawn" },
];

const SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "manual", label: "Manual entry" },
  { value: "cmc", label: "CMC MLS" },
  { value: "sjsr", label: "SJSR / Paragon" },
  { value: "bright", label: "Bright MLS" },
];

/**
 * Property add/edit form. Same shape as the now-retired ListingForm; just
 * lives under /components and points at /properties for cancel/redirect.
 *
 * Writes to the SEPARATE Alliance Listings DB (umziekblnbobkezbbupg) via the
 * shared createListingAction / updateListingAction. Those actions also
 * replicate into the local AllianceAnalytics `properties` table so the
 * /properties index picks the row up immediately.
 */
export default function PropertyForm({
  mode,
  initial,
  action,
  cancelHref = "/properties",
}: Props) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    action,
    null,
  );

  const i = initial ?? {};
  const isEdit = mode === "edit";

  return (
    <form action={formAction} className="space-y-6">
      {state?.error ? (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
        >
          {state.error}
        </div>
      ) : null}

      <Section title="Identity">
        <Field
          label="MLS number"
          name="mls_number"
          required
          defaultValue={i.mls_number ?? ""}
          placeholder="e.g. NJCM2310987 / CMC230456 / SJSR571832"
          mono
          disabled={isEdit}
          help={
            isEdit
              ? "MLS number is the primary key — to change it, delete and re-add."
              : "Used to auto-link posts and to keep listings unique."
          }
        />
        <Select
          label="Source"
          name="source_mls"
          options={SOURCE_OPTIONS}
          defaultValue={i.source_mls ?? "manual"}
        />
      </Section>

      <Section title="Address">
        <Field
          label="Street"
          name="address"
          required
          defaultValue={i.address ?? ""}
          placeholder="123 Park Ave"
          full
        />
        <Field
          label="City"
          name="city"
          defaultValue={i.city ?? ""}
          placeholder="Cherry Hill"
        />
        <Field
          label="State"
          name="state"
          defaultValue={i.state ?? "NJ"}
          placeholder="NJ"
        />
        <Field
          label="ZIP"
          name="zip"
          defaultValue={i.zip ?? ""}
          placeholder="08003"
        />
      </Section>

      <Section title="Status & timing">
        <Select
          label="Status"
          name="status"
          options={STATUS_OPTIONS}
          defaultValue={i.status ?? "active"}
        />
        <Field
          label="Listing date"
          name="listing_date"
          type="date"
          defaultValue={i.listing_date ?? ""}
        />
        <Field
          label="List price"
          name="list_price"
          type="text"
          defaultValue={
            i.list_price !== null && i.list_price !== undefined
              ? String(i.list_price)
              : ""
          }
          placeholder="585000"
          help="Whole dollars; commas and $ are stripped."
        />
      </Section>

      <Section title="Agent & office">
        <Field
          label="List agent name"
          name="list_agent_name"
          defaultValue={i.list_agent_name ?? ""}
          placeholder="John Crumb"
        />
        <Field
          label="List agent email"
          name="list_agent_email"
          type="email"
          defaultValue={i.list_agent_email ?? ""}
          placeholder="agent@c21alliance.com"
        />
        <Field
          label="Office ID"
          name="list_office_id"
          defaultValue={i.list_office_id ?? ""}
          placeholder="C21ALLIANCE-CH"
        />
      </Section>

      <Section title="Hero photo">
        <Field
          label="Hero image URL"
          name="hero_image_url"
          defaultValue={i.hero_image_url ?? ""}
          placeholder="https://photos.cmcmls.example/abc-1.jpg"
          help="Pasted from the MLS. Used as the cover photo on the seller report."
          full
        />
        {i.hero_image_url ? (
          <div className="sm:col-span-2">
            <div className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">
              Current hero
            </div>
            <div className="relative w-64 aspect-[4/3] rounded-lg overflow-hidden ring-1 ring-neutral-200 bg-neutral-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={i.hero_image_url}
                alt="Current hero"
                className="absolute inset-0 w-full h-full object-cover"
              />
            </div>
          </div>
        ) : null}
      </Section>

      <div className="flex items-center gap-3 pt-2 border-t border-neutral-200">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {pending
            ? "Saving…"
            : isEdit
              ? "Save changes"
              : "Create property"}
        </button>
        <Link href={cancelHref} className="btn-secondary text-sm">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-neutral-900 mb-3">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        {children}
      </div>
    </section>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  placeholder,
  required,
  help,
  full,
  mono,
  disabled,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  help?: string;
  full?: boolean;
  mono?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={"flex flex-col gap-1 " + (full ? "sm:col-span-2" : "")}>
      <span className="text-xs font-medium text-neutral-700">
        {label}
        {required ? <span className="text-rose-600 ml-0.5">*</span> : null}
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        type={type}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={
          "rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 " +
          "shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500 " +
          "disabled:bg-neutral-50 disabled:text-neutral-500 " +
          (mono ? "font-mono " : "")
        }
      />
      {help ? <span className="text-xs text-neutral-500">{help}</span> : null}
    </label>
  );
}

function Select({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-700">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
