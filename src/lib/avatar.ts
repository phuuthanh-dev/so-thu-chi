const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_ENCODED_LENGTH = 140_000;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type AvatarCrop = { zoom: number; x: number; y: number };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function validateAvatarFile(file: File) {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("Hãy chọn ảnh JPG, PNG hoặc WebP.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Ảnh cần nhỏ hơn 5 MB.");
}

export function avatarCropRect(width: number, height: number, crop: AvatarCrop) {
  const size = Math.min(width, height) / clamp(crop.zoom, 0.01, 3);
  const left = width - size, top = height - size;
  return { size, x: left < 0 ? left / 2 : left * clamp(crop.x, 0, 100) / 100, y: top < 0 ? top / 2 : top * clamp(crop.y, 0, 100) / 100 };
}

/** Decode and crop locally, limiting what is stored in the user's ledger. */
export async function prepareAvatar(file: File, crop: AvatarCrop = { zoom: 1, x: 50, y: 50 }): Promise<string> {
  validateAvatarFile(file);
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
    const rect = avatarCropRect(image.naturalWidth, image.naturalHeight, crop);
    ctx.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, 256, 256);
    let result = canvas.toDataURL("image/webp", 0.8);
    if (!result.startsWith("data:image/webp;base64,")) {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#f9edf1";
      ctx.fillRect(0, 0, 256, 256);
      result = canvas.toDataURL("image/jpeg", 0.8);
    }
    if (!result.startsWith("data:image/") || result.length > MAX_ENCODED_LENGTH)
      throw new Error("Ảnh sau khi xử lý vẫn quá lớn, hãy chọn ảnh khác.");
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}
