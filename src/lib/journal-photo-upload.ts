import {v2 as cloudinary} from "cloudinary";
import {UUID, type JournalSession} from "@/lib/journal-server";

type PhotoInput={entryId?:unknown;photoId?:unknown;image?:unknown};
type PhotoResult={id:string;status:number;error?:string};
type ReadyUpload={id:string;format:string;image:string;publicId:string};

// Reserve in the order chosen by the user; send the actual images in parallel.
export async function uploadJournalPhotos(session:JournalSession,inputs:PhotoInput[]):Promise<PhotoResult[]> {
  const jobs:({result:PhotoResult}|{upload:ReadyUpload})[]=[];
  for(const data of inputs){
    const id=typeof data.photoId==="string" ? data.photoId : "";
    if(typeof data.entryId!=="string" || !UUID.test(data.entryId) || !UUID.test(id) || typeof data.image!=="string" || data.image.length>1_250_000){jobs.push({result:{id,status:400,error:"Ảnh không hợp lệ."}});continue;}
    const match=/^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(data.image);
    if(!match){jobs.push({result:{id,status:400,error:"Ảnh không hợp lệ."}});continue;}
    const bytes=Buffer.from(match[2],"base64"),format=match[1]==="jpeg" ? "jpg" : "webp";
    if(!bytes.length || bytes.length>900_000 || (format==="jpg" ? !(bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) : !(bytes.subarray(0,4).toString()==="RIFF" && bytes.subarray(8,12).toString()==="WEBP"))){jobs.push({result:{id,status:400,error:"Ảnh không hợp lệ."}});continue;}
    try {
      const reserved=await session.client.rpc("journal_photo_reserve",{p_entry:data.entryId,p_photo:id,p_format:format});
      if(reserved.error)jobs.push({result:{id,status:400,error:"Không thể thêm ảnh. Mỗi bài tối đa 8 ảnh."}});
      else if(reserved.data==="ready")jobs.push({result:{id,status:200}});
      else if(reserved.data==="expired")jobs.push({result:{id,status:410,error:"Ảnh chưa tải xong. Hãy thử lại."}});
      else if(reserved.data!=="reserved")jobs.push({result:{id,status:409,error:"Ảnh đang được xử lý. Hãy thử lại sau."}});
      else jobs.push({upload:{id,format,image:data.image,publicId:`thu-chi/memories/${session.user.id}/${id}`}});
    } catch {jobs.push({result:{id,status:503,error:"Không thể chuẩn bị ảnh. Hãy thử lại."}});}
  }
  return Promise.all(jobs.map(async job=>{
    if("result" in job)return job.result;
    const {id,format,image,publicId}=job.upload;
    try {
      const uploaded=await cloudinary.uploader.upload(image,{public_id:publicId,asset_folder:"thu-chi/memories",type:"authenticated",resource_type:"image",overwrite:false});
      if(uploaded.public_id!==publicId || uploaded.type!=="authenticated" || uploaded.format!==format)throw new Error("Unexpected upload result");
      const finished=await session.client.rpc("journal_photo_finish",{p_photo:id,p_success:true});
      if(finished.error || !finished.data)throw new Error("Unable to attach photo");
      return {id,status:200};
    } catch {
      try {await session.client.rpc("journal_photo_finish",{p_photo:id,p_success:false});} catch {/* Pending reservation can expire and be retried. */}
      return {id,status:503,error:"Không tải được ảnh. Bạn có thể thử lại."};
    }
  }));
}
