export const RANDOM_UUID_POLYFILL = '<script>(function(){try{var c=globalThis.crypto;if(c&&typeof c.randomUUID!=="function"&&typeof c.getRandomValues==="function"){c.randomUUID=function(){var b=c.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var h="";for(var i=0;i<16;i++){h+=b[i].toString(16).padStart(2,"0")}return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20)}}}catch(e){}})();</script>'

export function injectRandomUuidPolyfill(html) {
  const match = /<head(?:\s[^>]*)?>/i.exec(html)
  if (match === null) return `${RANDOM_UUID_POLYFILL}${html}`
  const end = match.index + match[0].length
  return `${html.slice(0, end)}${RANDOM_UUID_POLYFILL}${html.slice(end)}`
}
