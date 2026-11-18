import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "nhà mình. | Sổ thu chi",
  description: "Một không gian nhỏ để chăm sóc tài chính mỗi ngày.",
  icons: {
    icon: [{ url: "/logo.png", type: "image/png" }],
    apple: [{ url: "/logo.png", type: "image/png" }],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
