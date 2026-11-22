const MAX_FILE=10*1024*1024;
export async function prepareJournalPhoto(file:File):Promise<string> {
  if (!["image/jpeg","image/png","image/webp"].includes(file.type)) throw new Error("Hãy chọn ảnh JPG, PNG hoặc WebP.");
  if (file.size>MAX_FILE) throw new Error("Mỗi ảnh cần nhỏ hơn 10 MB.");
  const source=URL.createObjectURL(file);
  try {
    const image=new window.Image();
    await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error("Không đọc được ảnh này."));image.src=source;});
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth*image.naturalHeight>40_000_000) throw new Error("Kích thước ảnh quá lớn.");
    const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement("canvas"); canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=canvas.getContext("2d"); if (!ctx) throw new Error("Trình duyệt không xử lý được ảnh.");
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    for (const quality of [0.82,0.7,0.55,0.4]) {
      let result=canvas.toDataURL("image/webp",quality);
      if (!result.startsWith("data:image/webp;")) result=canvas.toDataURL("image/jpeg",quality);
      if (result.length<=1_200_000) return result;
    }
    throw new Error("Ảnh sau khi xử lý vẫn quá lớn. Hãy chọn ảnh khác.");
  } finally { URL.revokeObjectURL(source); }
}
