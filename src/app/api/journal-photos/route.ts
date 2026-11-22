import {journalSession} from "@/lib/journal-server";
import {uploadJournalPhotos} from "@/lib/journal-photo-upload";
const noStore={"Cache-Control":"no-store"};
export async function POST(request:Request){
  const session=await journalSession(request);
  if(!session)return Response.json({error:"Vui lòng đăng nhập."},{status:401,headers:noStore});
  if(!process.env.CLOUDINARY_URL)return Response.json({error:"Không thể tải ảnh. Hãy thử lại."},{status:503,headers:noStore});
  if(Number(request.headers.get("content-length") || 0)>3_800_000)return Response.json({error:"Ảnh quá lớn."},{status:413,headers:noStore});
  let data:unknown;
  try{const body=await request.text();if(body.length>3_800_000)return Response.json({error:"Ảnh quá lớn."},{status:413,headers:noStore});data=JSON.parse(body);}catch{return Response.json({error:"Ảnh không hợp lệ."},{status:400,headers:noStore});}
  if(!Array.isArray(data) || data.length<1 || data.length>3 || data.some(item=>!item || typeof item!=="object" || Array.isArray(item)))return Response.json({error:"Ảnh không hợp lệ."},{status:400,headers:noStore});
  return Response.json({results:await uploadJournalPhotos(session,data)},{headers:noStore});
}
