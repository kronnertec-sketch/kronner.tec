'use client';
import {useMemo,useCallback} from 'react';
import {useSession} from '@clerk/react';
import {createClient} from '@supabase/supabase-js';
/** Supabase validates the Clerk JWT through its registered third-party provider. */
export function useApi(){
 const {session}=useSession();
 const client=useMemo(()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL||'https://jflrgtahcntqudqoxddh.supabase.co',process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_3bJ6vEcJS_gbdplio6zH_Q_9z1X99-f',{
  accessToken:async()=>session?(await session.getToken({template:'kroner_claims'}).catch(()=>session.getToken())):null,
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
 }),[session]);
 return useCallback(async(action:string,payload:Record<string,unknown>={})=>{
  const {data,error}=await client.rpc(action.startsWith('team:')?'kroner_team':action.startsWith('pos:')?'kroner_pos':action.startsWith('manage:')?'kroner_management':'kroner_api',{action:action.replace(/^(team|pos|manage):/,''),payload});
  if(error)throw new Error(error.message);
  return data;
 },[client]);
}
