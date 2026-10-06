// Run via agent-browser eval --stdin in localhost Test Grading only.
(async () => {
  if (!STATE.currentGrading?.testOnly || !['127.0.0.1','localhost'].includes(location.hostname)) throw new Error('Local practice QA only');
  const g=STATE.currentGrading, wasFullscreen=appIsFullscreen(), originalIndex=g.huidigeIndex;
  g.coverCleaning='cleaned';g.touchChecked=true;g.inspectionDialog=null;
  const results=[];
  try {
    for(let i=0;i<9;i++) {
      g.huidigeIndex=i;STATE.supplierNotice=null;render();
      await Promise.all([...document.querySelectorAll('.inspection-choices .inspection-photo img')].map(image=>image.decode()));
      const screen=document.querySelector('.inspection-screen'),footer=screen.querySelector('.inspection-footer');
      const photos=[...screen.querySelectorAll('.inspection-photo')].map(p=>({height:p.clientHeight,width:p.clientWidth,fit:getComputedStyle(p.querySelector('img')).objectFit}));
      if (photos.length!==4 || photos.some(p=>p.fit!=='contain'||p.height<90)) throw new Error('Incomplete or unreadable photos, step '+(i+1));
      if (!screen.classList.contains('inspection-fit') || document.documentElement.scrollHeight>innerHeight+2 || document.documentElement.scrollWidth>innerWidth+2 || footer.getBoundingClientRect().bottom>innerHeight+1) throw new Error('Viewport overflow, step '+(i+1));
      for (const control of screen.querySelectorAll('.inspection-choice,.inspection-photo-hint,.inspection-zoom,.inspection-footer button')) {
        const box=control.getBoundingClientRect();
        if(box.top<0 || box.bottom>innerHeight+1)throw new Error('Unreachable control, step '+(i+1));
      }
      if(appIsFullscreen()!==wasFullscreen)throw new Error('Fullscreen changed between steps');
      results.push({step:i+1,columns:Number(screen.querySelector('.inspection-choices').dataset.columns),photoHeight:Math.min(...photos.map(p=>p.height))});
    }
    return {viewport:[innerWidth,innerHeight],language:STATE.language,fullscreen:wasFullscreen,noPageScroll:true,steps:results};
  } finally { g.huidigeIndex=originalIndex;render(); }
})()
