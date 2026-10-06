(() => {
  'use strict';
  const key='zhihuSoftNightEnabled';
  const storage=chrome.storage.local;
  ZhihuSoftNight.create({
    read:()=>storage.get({[key]:true}).then(result=>result[key]),
    write:value=>storage.set({[key]:value}),
    subscribe:callback=>{
      const listener=(changes,area)=>{if(area==='local'&&changes[key])callback(changes[key].newValue!==false);};
      chrome.storage.onChanged.addListener(listener);
      return ()=>chrome.storage.onChanged.removeListener(listener);
    }
  });
})();
