// Required by Next.js parallel route slots: when no modal is active for the
// current segment, the @modal slot must explicitly render nothing. Returning
// null tells the layout to render only the main `children` slot.
export default function ModalDefault() {
  return null;
}
