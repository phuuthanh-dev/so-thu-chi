const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_ENCODED_LENGTH = 140_000;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Decode and center-crop locally, limiting what is stored in the user's ledger. */
export async function prepareAvatar(file: File): Promise<string> {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("Hãy chọn ảnh JPG, PNG hoặc WebP.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Ảnh cần nhỏ hơn 5 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Không đọc được ảnh. Hãy chọn ảnh khác."));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 20_000_000)
      throw new Error("Kích thước ảnh không hợp lệ hoặc quá lớn.");
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Trình duyệt không xử lý được ảnh này.");
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    let result = canvas.toDataURL("image/webp", 0.8);
    if (!result.startsWith("data:image/webp;base64,")) result = canvas.toDataURL("image/jpeg", 0.8);
    if (!result.startsWith("data:image/") || result.length > MAX_ENCODED_LENGTH)
      throw new Error("Ảnh sau khi xử lý vẫn quá lớn, hãy chọn ảnh khác.");
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}
