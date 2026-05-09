"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { OfficeRow } from "@/lib/data/offices";

interface ActionState {
  ok: boolean;
  error?: string;
}

interface Props {
  office: OfficeRow;
  action: (
    prev: ActionState | null,
    form: FormData,
  ) => Promise<ActionState>;
}

/**
 * Full edit form for one offices row. Used in
 * /settings/offices/[short_code]/edit.
 *
 * Comma-separated list fields (towns_served, zip_codes_served,
 * signature_angles) are entered as a single text input; the server action
 * splits on commas and trims each entry.
 */
export default function OfficeForm({ office, action }: Props) {
  const [state, formAction, pending] = useActionState<
    ActionState | null,
    FormData
  >(action, null);

  const towns = arrToCsv(office.towns_served);
  const zips = arrToCsv(office.zip_codes_served);
  const angles = arrToCsv(office.signature_angles);

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
          label="Office name"
          name="name"
          required
          defaultValue={office.name}
          full
        />
        <ReadonlyField label="Short code" value={office.short_code} mono />
        <Field
          label="Display name"
          name="display_name"
          defaultValue={office.display_name ?? ""}
          placeholder="Marketing-friendly name"
          full
        />
      </Section>

      <Section title="Location">
        <Field
          label="Address"
          name="address"
          defaultValue={office.address ?? ""}
          full
        />
        <Field
          label="City"
          name="city"
          defaultValue={office.city ?? ""}
        />
        <Field
          label="State"
          name="state"
          defaultValue={office.state ?? "NJ"}
          placeholder="NJ"
        />
        <Field
          label="Zip"
          name="zip"
          defaultValue={office.zip ?? ""}
        />
        <Field
          label="Phone"
          name="phone"
          defaultValue={office.phone ?? ""}
        />
        <Field
          label="Primary contact"
          name="primary_contact"
          defaultValue={office.primary_contact ?? ""}
          full
        />
      </Section>

      <Section title="Towns and zips served">
        <ChipsField
          label="Towns served"
          name="towns_served"
          defaultValue={towns}
          help="Comma-separated. Used to infer office on incoming posts."
          chips={office.towns_served ?? []}
        />
        <ChipsField
          label="Zip codes served"
          name="zip_codes_served"
          defaultValue={zips}
          help="Comma-separated. Used as a fallback when town isn't recognized."
          chips={office.zip_codes_served ?? []}
        />
        <ChipsField
          label="Signature angles"
          name="signature_angles"
          defaultValue={angles}
          help="Comma-separated content angles this office leans into (e.g. 'shore lifestyle, summer rentals')."
          chips={office.signature_angles ?? []}
        />
      </Section>

      <Section title="Market profile">
        <TextareaField
          label="Primary buyer demographic"
          name="primary_buyer_demo"
          defaultValue={office.primary_buyer_demo ?? ""}
          placeholder="Who buys here? Describe age, income, life-stage, motivation."
          full
        />
        <TextareaField
          label="Primary seller demographic"
          name="primary_seller_demo"
          defaultValue={office.primary_seller_demo ?? ""}
          placeholder="Who sells here? What's their typical situation?"
          full
        />
        <TextareaField
          label="Seasonal pattern"
          name="seasonal_pattern"
          defaultValue={office.seasonal_pattern ?? ""}
          placeholder="When is this market hot, soft, or steady? Holidays, summer surge, etc."
          full
        />
        <TextareaField
          label="Notes"
          name="notes"
          defaultValue={office.notes ?? ""}
          placeholder="Internal notes — not visible outside admin."
          full
        />
      </Section>

      <Section title="Price ranges">
        <Field
          label="Min"
          name="price_range_min"
          type="number"
          defaultValue={
            office.price_range_min !== null && office.price_range_min !== undefined
              ? String(office.price_range_min)
              : ""
          }
          placeholder="250000"
        />
        <Field
          label="Median"
          name="price_range_median"
          type="number"
          defaultValue={
            office.price_range_median !== null &&
            office.price_range_median !== undefined
              ? String(office.price_range_median)
              : ""
          }
          placeholder="475000"
        />
        <Field
          label="High"
          name="price_range_high"
          type="number"
          defaultValue={
            office.price_range_high !== null &&
            office.price_range_high !== undefined
              ? String(office.price_range_high)
              : ""
          }
          placeholder="1500000"
        />
      </Section>

      <Section title="Status">
        <CheckboxField
          label="Active"
          name="is_active"
          defaultChecked={office.is_active}
          help="Inactive offices are hidden from filters and the inference pipeline."
        />
      </Section>

      <div className="flex items-center gap-3 pt-2 border-t border-neutral-200">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <Link href="/settings/offices" className="btn-secondary text-sm">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function arrToCsv(arr: string[] | null | undefined): string {
  if (!arr || arr.length === 0) return "";
  return arr.join(", ");
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
        className={
          "rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 " +
          "shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500 " +
          (mono ? "font-mono " : "")
        }
      />
      {help ? <span className="text-xs text-neutral-500">{help}</span> : null}
    </label>
  );
}

function ReadonlyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-700">{label}</span>
      <input
        value={value}
        readOnly
        className={
          "rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500 cursor-not-allowed " +
          (mono ? "font-mono " : "")
        }
      />
    </label>
  );
}

function TextareaField({
  label,
  name,
  defaultValue,
  placeholder,
  full,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  full?: boolean;
}) {
  return (
    <label className={"flex flex-col gap-1 " + (full ? "sm:col-span-2" : "")}>
      <span className="text-xs font-medium text-neutral-700">{label}</span>
      <textarea
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        rows={3}
        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
      />
    </label>
  );
}

function ChipsField({
  label,
  name,
  defaultValue,
  help,
  chips,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  help?: string;
  chips: string[];
}) {
  return (
    <label className="flex flex-col gap-1 sm:col-span-2">
      <span className="text-xs font-medium text-neutral-700">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        type="text"
        placeholder="value 1, value 2, value 3"
        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
      />
      {chips.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c}
              className="inline-flex items-center rounded-md bg-neutral-50 ring-1 ring-neutral-200 px-2 py-0.5 text-xs text-neutral-600"
            >
              {c}
            </span>
          ))}
        </div>
      ) : null}
      {help ? <span className="text-xs text-neutral-500">{help}</span> : null}
    </label>
  );
}

function CheckboxField({
  label,
  name,
  defaultChecked,
  help,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
  help?: string;
}) {
  return (
    <label className="flex flex-col gap-1 sm:col-span-2">
      <span className="inline-flex items-center gap-2 text-xs font-medium text-neutral-700">
        <input
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          value="1"
          className="h-4 w-4 rounded border-neutral-300 text-gold-600 focus:ring-gold-500"
        />
        {label}
      </span>
      {help ? <span className="text-xs text-neutral-500">{help}</span> : null}
    </label>
  );
}
