// A local fallback keeps the app usable before Cloudinary is configured.
export const brandLogo = process.env.NEXT_PUBLIC_CLOUDINARY_LOGO_URL || "/logo.png";
