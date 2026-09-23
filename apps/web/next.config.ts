import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next.js Server Actions default to a 1MB request body cap — far below
  // this plan's product-media upload ceiling (5MB images / 50MB video, see
  // apps/api/src/modules/catalog/media.service.ts's MAX_IMAGE_BYTES /
  // MAX_VIDEO_BYTES). Without raising this, MediaUploader's own upload
  // Server Action would 413 on every video and most images before ever
  // reaching the API's own size validation. Rule 2 (missing critical
  // functionality) fix, not in this plan's original file list.
  experimental: {
    serverActions: {
      bodySizeLimit: "60mb",
    },
  },
};

export default createNextIntlPlugin()(nextConfig);
