export type PayableSyncState={activated:number;status:string;last_completed?:string;error?:string};

/** A successful empty snapshot is different from not knowing today's balance. */
export function payableSyncView(state:PayableSyncState|undefined,{readFailed=false,syncFailed=false,syncing=false}={}){
 const last=state?.last_completed;
 const lastSuccess=last&&Number.isFinite(Date.parse(last))?last:null;
 const status=readFailed?'read_error':syncFailed?'error':syncing?'syncing':state?.status||'loading';
 const fresh=status==='synced'&&state?.activated===1&&!!lastSuccess;
 const mode=fresh?'fresh':lastSuccess?'snapshot':status==='loading'?'loading':'unknown';
 const statusLabels:Record<string,string>={
  loading:'读取中',read_error:'读取失败',paused:'同步已暂停',synced:'已同步',
  syncing:'同步中',error:'同步失败',review_required:'尚未启用',
 };
 return {
  mode,lastSuccess,
  statusLabel:status==='synced'&&!fresh?'状态未知':statusLabels[status]||'状态未知',
  isError:status==='read_error'||status==='error',
  emptyLabel:mode==='fresh'?'暂无待付款':mode==='snapshot'?'上次同步暂无待付款':null,
 };
}
