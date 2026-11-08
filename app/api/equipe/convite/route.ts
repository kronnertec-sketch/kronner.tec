import {createClient} from '@supabase/supabase-js';
export async function POST(request:Request){
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return Response.json({error:'Entre na sua conta.'},{status:401});
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL||'https://hfyvmflezsbylnxrloyu.supabase.co',process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_g7UOIX7I58BFs-Mg_U87zA_wLBCxRac',{accessToken:async()=>authorization.slice(7),auth:{persistSession:false}});
 const body=await request.json().catch(()=>null);
 if(!body||typeof body.email!=='string')return Response.json({error:'Informe o e-mail do profissional.'},{status:400});
 const {data,error}=await db.rpc('kroner_team',{action:'invite',payload:{name:body.name,email:body.email,role:body.role}});
 if(error)return Response.json({error:error.message},{status:400});
 const url=new URL('/entrar',process.env.KRONER_PUBLIC_ORIGIN||'https://kroner-barbearias.vercel.app');
 url.searchParams.set('mode','signup');
 url.searchParams.set('next','/equipe#'+data.token);
 let sent=false;
 if(process.env.CLERK_SECRET_KEY){
   try{
     const result=await fetch('https://api.clerk.com/v1/invitations',{method:'POST',headers:{Authorization:'Bearer '+process.env.CLERK_SECRET_KEY,'Content-Type':'application/json'},body:JSON.stringify({email_address:body.email.trim(),redirect_url:url.toString(),expires_in_days:7,notify:true,ignore_existing:true})});
     sent=result.ok;
   }catch{}
 }
 return Response.json({token:data.token,sent},{headers:{'Cache-Control':'no-store'}});
}
