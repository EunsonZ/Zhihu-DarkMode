(() => {
  'use strict';
  const key='zhihuSoftNightEnabled', input=document.getElementById('enabled'), status=document.getElementById('status');
  const render=value=>{input.checked=value;status.textContent=value?'已启用，已打开的知乎页面会同步更新。':'已关闭，网页恢复原来的外观。';};
  chrome.storage.local.get({[key]:true}).then(result=>{render(result[key]!==false);input.disabled=false;}).catch(()=>{status.textContent='无法读取设置，请重新打开。';});
  input.addEventListener('change',async()=>{
    const value=input.checked;input.disabled=true;
    try{await chrome.storage.local.set({[key]:value});render(value);}catch{input.checked=!value;status.textContent='保存失败，请重试。';}finally{input.disabled=false;}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[key])render(changes[key].newValue!==false);});
})();
