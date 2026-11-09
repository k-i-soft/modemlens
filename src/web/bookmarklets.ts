import type { WebDialect } from './dialects';

export const CAPTURE_FORMAT = 'modemlens-web-capture';
export const CAPTURE_VERSION = 1;

export function captureFileName(dialect: WebDialect): string {
  return `modemlens-capture-${dialect.id}.json`;
}

const WRONG_PAGE =
  'ModemLens saved nothing: this page did not answer like a modem. Open the web page of the stick itself first, then click this bookmark again.';

/**
 * The script a person runs on the modem's own page. It sends fixed GET requests with relative paths and
 * refuses a redirect, so nothing reaches another host; the answers go into a file on this computer only.
 * The text survives being stored as a URL: no percent signs, number signs, double quotes or backslashes.
 */
export function buildBookmarklet(dialect: WebDialect): string {
  const file = captureFileName(dialect);
  const saved = `Saved ${file}. It holds identifiers of the modem and the SIM, so keep it private unless you export it through ModemLens.`;
  const endpoints = dialect.endpoints.map((e) => `['${e.id}','${e.path}']`).join(',');
  const capture =
    `{format:'${CAPTURE_FORMAT}',version:${CAPTURE_VERSION},dialect:'${dialect.id}',capturedAt:new Date().toISOString(),responses:r}`;
  const code = [
    `const r=[];`,
    `for(const[id,p]of[${endpoints}]){let s=0,b='';try{const x=await fetch(p,{redirect:'error'});s=x.status;b=await x.text()}catch(_){}r.push({id:id,status:s,body:b})}`,
    `if(!r.some(q=>q.status===200&&/${dialect.answerPattern}/.test(q.body))){alert('${WRONG_PAGE}');return}`,
    `const a=document.createElement('a');`,
    `a.href=URL.createObjectURL(new Blob([JSON.stringify(${capture},null,1)],{type:'application/json'}));`,
    `a.download='${file}';document.body.appendChild(a);a.click();a.remove();`,
    `alert('${saved}')`,
  ].join('');
  return `javascript:(async()=>{${code}})()`;
}
