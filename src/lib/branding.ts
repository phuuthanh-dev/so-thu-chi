// Keep the original PNG for favicons; use a smaller adaptive image in the UI.
export const brandLogo = process.env.NEXT_PUBLIC_CLOUDINARY_LOGO_URL || "/logo.png";
export const brandLogoDisplay = brandLogo.startsWith("https://res.cloudinary.com/")
  ? brandLogo.replace("/image/upload/", "/image/upload/f_auto,q_auto,w_96/")
  : brandLogo;
