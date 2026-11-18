import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AvatarEditor } from "../src/app/avatar-editor";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("xem trước và lưu đúng vùng cắt được chọn bằng các thanh điều chỉnh", async () => {
  const revoke = vi.fn(), save = vi.fn(), cancel = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: () => "blob:preview", revokeObjectURL: revoke });
  const user = userEvent.setup();
  const view = render(<AvatarEditor file={new File(["x"], "a.png", { type: "image/png" })} onSave={save} onCancel={cancel} error="" busy={false} motionEnabled={false} />);
  const image = await waitFor(() => { const value = view.container.querySelector(".avatar-crop-preview img"); if (!value) throw new Error("waiting for image"); return value; });
  Object.defineProperty(image, "naturalWidth", { value: 640 }); Object.defineProperty(image, "naturalHeight", { value: 400 });
  fireEvent.load(image);
  expect(Number((screen.getByRole("slider", { name: "Độ phóng ảnh" }) as HTMLInputElement).min)).toBeLessThan(1);
  fireEvent.change(screen.getByRole("slider", { name: "Độ phóng ảnh" }), { target: { value: "0.52" } });
  expect(parseFloat((image as HTMLElement).style.left)).toBeGreaterThan(0);
  expect(parseFloat((image as HTMLElement).style.top)).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole("slider", { name: "Độ phóng ảnh" }), { target: { value: "2" } });
  fireEvent.change(screen.getByRole("slider", { name: "Vị trí ngang" }), { target: { value: "0" } });
  fireEvent.change(screen.getByRole("slider", { name: "Vị trí dọc" }), { target: { value: "100" } });
  expect((image as HTMLElement).style.width).toBe("320%");
  expect((image as HTMLElement).style.top).toBe("-100%");
  await user.click(screen.getByRole("button", { name: "Lưu ảnh" }));
  expect(save).toHaveBeenCalledWith({ zoom: 2, x: 0, y: 100 });
  view.unmount(); expect(revoke).toHaveBeenCalledWith("blob:preview");
});

it("báo ảnh không đọc được và không cho lưu", async () => {
  vi.stubGlobal("URL", { createObjectURL: () => "blob:preview", revokeObjectURL: vi.fn() });
  const view = render(<AvatarEditor file={new File(["x"], "a.png", { type: "image/png" })} onSave={vi.fn()} onCancel={vi.fn()} error="" busy={false} motionEnabled={false} />);
  const image = await waitFor(() => { const value = view.container.querySelector(".avatar-crop-preview img"); if (!value) throw new Error("waiting for image"); return value; });
  fireEvent.error(image);
  expect(screen.getByRole("alert").textContent).toContain("Không đọc được ảnh");
  expect((screen.getByRole("button", { name: "Lưu ảnh" }) as HTMLButtonElement).disabled).toBe(true);
});
