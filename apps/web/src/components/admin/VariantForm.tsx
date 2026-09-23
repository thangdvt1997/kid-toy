"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { AdminVariantDto, CertificationDto } from "@kid-toy/shared-types";
import FormError from "@/components/FormError";
import {
  adminInitialState,
  createCertificationAction,
  createVariantAction,
  deleteCertificationAction,
  updateVariantAction,
} from "@/lib/admin-actions";

function CertificationRow({
  productId,
  certification,
}: {
  productId: string;
  certification: CertificationDto;
}) {
  const t = useTranslations("Admin");

  async function handleDelete() {
    await deleteCertificationAction(productId, certification.id);
  }

  return (
    <li>
      <span>
        {certification.certNumber} — {certification.issuingBody} (
        {certification.validFrom.slice(0, 10)} – {certification.validTo.slice(0, 10)})
        {certification.batchLabel ? ` — ${certification.batchLabel}` : ""}
      </span>
      <form action={handleDelete}>
        <button type="submit">{t("delete")}</button>
      </form>
    </li>
  );
}

function CertificationForm({ productId, variantId }: { productId: string; variantId: string }) {
  const t = useTranslations("Admin");
  const [state, formAction, pending] = useActionState(
    createCertificationAction.bind(null, productId, variantId),
    adminInitialState,
  );

  return (
    <form action={formAction}>
      <label>
        {t("certNumber")}
        <input name="certNumber" required />
      </label>
      <label>
        {t("issuingBody")}
        <input name="issuingBody" required />
      </label>
      <label>
        {t("validFrom")}
        <input type="date" name="validFrom" required />
      </label>
      <label>
        {t("validTo")}
        <input type="date" name="validTo" required />
      </label>
      <label>
        {t("batchLabel")}
        <input name="batchLabel" />
      </label>
      <button type="submit" disabled={pending}>
        {t("addCertification")}
      </button>
      <FormError messageKey={state.ok ? undefined : state.error || undefined} />
    </form>
  );
}

function CertificationSection({
  productId,
  variantId,
  certifications,
}: {
  productId: string;
  variantId: string;
  certifications: CertificationDto[];
}) {
  const t = useTranslations("Admin");
  return (
    <section>
      <h4>{t("certificationsTitle")}</h4>
      {certifications.length > 0 ? (
        <ul>
          {certifications.map((cert) => (
            <CertificationRow key={cert.id} productId={productId} certification={cert} />
          ))}
        </ul>
      ) : null}
      <CertificationForm productId={productId} variantId={variantId} />
    </section>
  );
}

/**
 * `variant` omitted => a blank "add variant" form (createVariantAction).
 * `variant` present => an edit form pre-filled with its current values
 * (updateVariantAction), plus its nested certification sub-form/list
 * (CATALOG-04) directly beneath, exactly as the plan's action text
 * describes.
 */
export default function VariantForm({
  productId,
  variant,
}: {
  productId: string;
  variant?: AdminVariantDto;
}) {
  const t = useTranslations("Admin");
  const action = variant
    ? updateVariantAction.bind(null, productId, variant.id)
    : createVariantAction.bind(null, productId);
  const [state, formAction, pending] = useActionState(action, adminInitialState);

  return (
    <div>
      <form action={formAction}>
        <label>
          {t("sku")}
          <input
            name="sku"
            defaultValue={variant?.sku ?? ""}
            style={{ textTransform: "uppercase" }}
            pattern="[A-Za-z0-9][A-Za-z0-9-]{2,31}"
            required
          />
        </label>
        <label>
          {t("barcode")}
          <input name="barcode" defaultValue={variant?.barcode ?? ""} pattern="\d{8,14}" />
        </label>
        <label>
          {t("variantLabel")}
          <input name="variantLabel" defaultValue={variant?.variantLabel ?? ""} />
        </label>
        <label>
          {t("unitsPerInnerBox")}
          <input type="number" name="unitsPerInnerBox" min={1} defaultValue={variant?.unitsPerInnerBox ?? ""} />
        </label>
        <label>
          {t("unitsPerMasterCarton")}
          <input
            type="number"
            name="unitsPerMasterCarton"
            min={1}
            defaultValue={variant?.unitsPerMasterCarton ?? ""}
          />
        </label>
        <label>
          {t("cartonLengthCm")}
          <input type="number" step="0.01" name="cartonLengthCm" defaultValue={variant?.cartonLengthCm ?? ""} />
        </label>
        <label>
          {t("cartonWidthCm")}
          <input type="number" step="0.01" name="cartonWidthCm" defaultValue={variant?.cartonWidthCm ?? ""} />
        </label>
        <label>
          {t("cartonHeightCm")}
          <input type="number" step="0.01" name="cartonHeightCm" defaultValue={variant?.cartonHeightCm ?? ""} />
        </label>
        <label>
          {t("cartonWeightKg")}
          <input type="number" step="0.001" name="cartonWeightKg" defaultValue={variant?.cartonWeightKg ?? ""} />
        </label>
        <button type="submit" disabled={pending}>
          {variant ? t("save") : t("addVariant")}
        </button>
        <FormError messageKey={state.ok ? undefined : state.error || undefined} />
      </form>

      {variant ? (
        <CertificationSection
          productId={productId}
          variantId={variant.id}
          certifications={variant.certifications}
        />
      ) : null}
    </div>
  );
}
