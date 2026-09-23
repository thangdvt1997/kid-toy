"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { MediaDto } from "@kid-toy/shared-types";
import FormError from "@/components/FormError";
import {
  adminInitialState,
  deleteMediaAction,
  reorderMediaAction,
  uploadMediaAction,
} from "@/lib/admin-actions";

/**
 * File input + type/alt-text fields + an ordered list of existing media
 * with Move up/down/Delete. Reordering always submits the FULL recomputed
 * `orderedIds` array (the API rejects a partial list — see media.service.ts
 * `reorder`'s isPermutation check).
 */
export default function MediaUploader({ productId, media }: { productId: string; media: MediaDto[] }) {
  const t = useTranslations("Admin");
  const [uploadState, uploadFormAction, uploadPending] = useActionState(
    uploadMediaAction.bind(null, productId),
    adminInitialState,
  );
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState("");

  const sorted = [...media].sort((a, b) => a.sortOrder - b.sortOrder);

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const next = [...sorted];
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    const orderedIds = next.map((m) => m.id);
    startTransition(async () => {
      const result = await reorderMediaAction(productId, orderedIds);
      setActionError(result.ok ? "" : result.error);
    });
  }

  function remove(mediaId: string) {
    startTransition(async () => {
      const result = await deleteMediaAction(productId, mediaId);
      setActionError(result.ok ? "" : result.error);
    });
  }

  return (
    <section>
      <h3>{t("mediaTitle")}</h3>
      {sorted.length > 0 ? (
        <ul>
          {sorted.map((item, index) => (
            <li key={item.id}>
              {item.type === "IMAGE" ? (
                // Admin-only, unstyled, arbitrary presigned MinIO URLs — not a
                // static asset set next/image can optimize.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt={item.altTextVi ?? item.altTextEn ?? ""} width={120} />
              ) : (
                <video src={item.url} width={160} controls />
              )}
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0 || isPending}>
                {t("moveUp")}
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === sorted.length - 1 || isPending}
              >
                {t("moveDown")}
              </button>
              <button type="button" onClick={() => remove(item.id)} disabled={isPending}>
                {t("delete")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <FormError messageKey={actionError || undefined} />

      <form action={uploadFormAction} encType="multipart/form-data">
        <label>
          {t("mediaType")}
          <select name="type" defaultValue="IMAGE">
            <option value="IMAGE">{t("mediaTypeImage")}</option>
            <option value="VIDEO">{t("mediaTypeVideo")}</option>
          </select>
        </label>
        <label>
          {t("altTextVi")}
          <input name="altTextVi" />
        </label>
        <label>
          {t("altTextEn")}
          <input name="altTextEn" />
        </label>
        <label>
          <input
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            required
          />
        </label>
        <small>{t("mediaHint")}</small>
        <button type="submit" disabled={uploadPending}>
          {t("uploadMedia")}
        </button>
        <FormError messageKey={uploadState.ok ? undefined : uploadState.error || undefined} />
      </form>
    </section>
  );
}
