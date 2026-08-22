export const RANDOM_UUID_POLYFILL = '<script>(function(){try{var c=globalThis.crypto;if(c&&typeof c.randomUUID!=="function"&&typeof c.getRandomValues==="function"){c.randomUUID=function(){var b=c.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var h="";for(var i=0;i<16;i++){h+=b[i].toString(16).padStart(2,"0")}return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20)}}}catch(e){}})();</script>'

export const PLUGIN_RECOVERY_GUARD = `<script>(function(){
try{
var nativeFetch=globalThis.fetch.bind(globalThis),markerKey="dsh-platform:plugin-load-recovery",waitPath="/_dsh_gateway/wait";
function plugin(url){var match=url.pathname.match(/^\\/plugins\\/(.+)\\/client\\.js$/);if(!match)return null;try{return decodeURIComponent(match[1])}catch(e){return match[1]}}
function target(input){try{return new URL(typeof input==="string"?input:input.url,location.href)}catch(e){return null}}
function marker(){try{var value=JSON.parse(sessionStorage.getItem(markerKey));return value&&Date.now()-value.createdAt<120000?value:null}catch(e){return null}}
function save(value){try{sessionStorage.setItem(markerKey,JSON.stringify(value))}catch(e){}}
function report(event,fields){nativeFetch("/_dsh_gateway/client-event",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.assign({event:event,pathname:location.pathname},fields)),keepalive:true}).catch(function(){})}
async function json(path){try{var response=await nativeFetch(path,{cache:"no-store"});return await response.json()}catch(e){return {}}}
function transition(value){return ["restarting","switching","recovering","restart-failed"].includes(value.operation)||["snapshotting-data","switching","probation","restoring-data"].includes(value.update&&value.update.status)||["starting","stopping","stopped","restarting","recovering","failed"].includes(value.dshLifecycle&&value.dshLifecycle.state)}
async function recover(url,pluginId,reason){
var values=await Promise.all([json("/_dsh_gateway/readiness"),json("/_dsh_platform/plugin-api/v1/status")]),readiness=values[0],status=values[1],lifecycle=status.dshLifecycle||{},updated=Date.parse(lifecycle.updatedAt),recent=typeof lifecycle.taskId==="string"&&Number.isFinite(updated)&&Date.now()-updated<30000,eligible=transition(status)||recent;
var identity=typeof lifecycle.taskId==="string"?lifecycle.taskId:(lifecycle.updatedAt||readiness.state||"unknown"),previous=marker(),fields={pluginId:pluginId,revision:url.searchParams.get("rev"),lifecycleState:lifecycle.state||readiness.state||null,lifecycleTaskId:lifecycle.taskId||null,recoveryAttempt:1,reason:reason};
if(!eligible){report("browser.plugin-load.failed",Object.assign({level:"error",recoveryAttempt:0},fields));return false}
if(previous&&previous.identity===identity){report("browser.plugin-load.recovery.failed",Object.assign({level:"error",recoveryAttempt:previous.attempt+1},fields));return false}
report("browser.plugin-load.failed",Object.assign({level:"warning"},fields));
save({identity:identity,taskId:lifecycle.taskId||null,url:url.pathname+url.search,pluginId:pluginId,attempt:1,createdAt:Date.now(),completed:false});
report("browser.plugin-load.recovery.started",Object.assign({level:"warning"},fields));
var back=location.pathname+location.search+location.hash;location.replace(waitPath+"?return="+encodeURIComponent(back));return true
}
function completed(url,pluginId){var value=marker();if(!value||value.completed||value.url!==url.pathname+url.search)return;value.completed=true;save(value);report("browser.plugin-load.recovery.completed",{level:"info",pluginId:pluginId,revision:url.searchParams.get("rev"),lifecycleTaskId:value.taskId||null,recoveryAttempt:value.attempt})}
globalThis.fetch=function(input,init){var url=target(input),pluginId=url&&plugin(url),pending=nativeFetch(input,init);if(!pluginId)return pending;return pending.then(function(response){if(response.ok){completed(url,pluginId);return response}if(response.status!==502&&response.status!==503)return response;return recover(url,pluginId,"HTTP "+response.status).then(function(active){return active?new Promise(function(){}):response})},function(error){return recover(url,pluginId,error&&error.name||"network error").then(function(active){if(active)return new Promise(function(){});throw error})})}
function failedBoot(){var nodes=document.querySelectorAll("div"),title=null;for(var i=0;i<nodes.length;i++){if(nodes[i].children.length===0&&nodes[i].textContent==="Failed to load plugins"){title=nodes[i];break}}if(!title)return null;var text=(title.parentElement&&title.parentElement.textContent)||title.textContent,match=text.match(/\\/plugins\\/((?:@[^/\\s]+\\/)?[^/\\s]+)\\/client\\.js(?:\\?rev=([A-Za-z0-9._~%-]+))?/),url=target(match?match[0]:"/plugins/unknown/client.js");return url&&{url:url,pluginId:match?match[1]:"unknown",reason:"DSH plugin loader failed"}}
function watchBoot(){var handled=false,observer=new MutationObserver(function(){if(handled)return;var value=failedBoot();if(!value)return;handled=true;recover(value.url,value.pluginId,value.reason).then(function(active){if(!active)observer.disconnect()})});observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true})}
if(document.documentElement)watchBoot();else addEventListener("DOMContentLoaded",watchBoot,{once:true});
}catch(e){}
})();</script>`

export function injectRandomUuidPolyfill(html) {
  const match = /<head(?:\s[^>]*)?>/i.exec(html)
  const injected = `${RANDOM_UUID_POLYFILL}${PLUGIN_RECOVERY_GUARD}`
  if (match === null) return `${injected}${html}`
  const end = match.index + match[0].length
  return `${html.slice(0, end)}${injected}${html.slice(end)}`
}
