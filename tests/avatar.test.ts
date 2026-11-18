import { afterEach, expect, it, vi } from "vitest";
import { avatarCropRect, prepareAvatar } from "../src/lib/avatar";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("từ chối loại tệp không phải ảnh và tệp lớn hơn 5 MB", async () => {
  await expect(prepareAvatar(new File(["x"], "file.txt", { type: "text/plain" }))).rejects.toThrow("JPG, PNG hoặc WebP");
  await expect(prepareAvatar(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }))).rejects.toThrow("5 MB");
});

it("tính vùng cắt theo vị trí và độ phóng, giới hạn trong ảnh", () => {
  expect(avatarCropRect(640, 400, { zoom: 2, x: 0, y: 100 })).toEqual({ x: 0, y: 200, size: 200 });
  expect(avatarCropRect(640, 400, { zoom: 2, x: 100, y: 0 })).toEqual({ x: 440, y: 0, size: 200 });
  expect(avatarCropRect(640, 400, { zoom: 1, x: -3, y: 200 })).toEqual({ x: 0, y: 0, size: 400 });
  expect(avatarCropRect(400, 800, { zoom: 0.5, x: 50, y: 50 })).toEqual({ x: -200, y: 0, size: 800 });
});

it("cắt vuông ở giữa, nén ảnh và giải phóng URL tạm", async () => {
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: revoke });
  class FakeImage {
    naturalWidth = 640; naturalHeight = 400;
    onload: () => void = () => {};
    set src(_value: string) { queueMicrotask(() => this.onload()); }
  }
  vi.stubGlobal("Image", FakeImage);
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/webp;base64,YQ==");
  const result = await prepareAvatar(new File(["data"], "photo.png", { type: "image/png" }));
  expect(result).toBe("data:image/webp;base64,YQ==");
  expect(draw).toHaveBeenCalledWith(expect.anything(), 120, 0, 400, 400, 0, 0, 256, 256);
  expect(revoke).toHaveBeenCalledWith("blob:test");
  await prepareAvatar(new File(["data"], "photo.png", { type: "image/png" }), { zoom: 2, x: 0, y: 100 });
  expect(draw).toHaveBeenLastCalledWith(expect.anything(), 0, 200, 200, 200, 0, 0, 256, 256);
});
