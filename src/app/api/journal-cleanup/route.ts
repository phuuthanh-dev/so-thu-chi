import { cleanupJournalPhotos, journalSession } from "@/lib/journal-server";
export async function POST(request:Request) {
  const session=await journalSession(request);
  if (!session) return new Response(null,{status:401,headers:{"Cache-Control":"no-store"}});
  await cleanupJournalPhotos(session);
  return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
}
