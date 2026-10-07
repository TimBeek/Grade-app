const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),app={};vm.createContext(app);
vm.runInContext(fs.readFileSync(path.join(root,'assets/grading-engine.js'),'utf8'),app);
vm.runInContext(fs.readFileSync(path.join(root,'assets/grading-example-images.js'),'utf8'),app);
const result=vm.runInContext(`Object.entries(CHOICE_DECISIONS).flatMap(([component,grades])=>Object.entries(grades).flatMap(([grade,d])=>{
  const walk=(decision,steps)=>withGradingExampleImages({...decision,componentId:component}).options.flatMap((o,i)=>[{component,grade,path:steps.concat(i).join('.'),label:o.label,image:o.image||null},...(o.nextDecision?walk(o.nextDecision,steps.concat(i)):[])]);
  return walk(d,[]);
}))`,app);
for(const item of result.filter(item=>!item.image || !fs.existsSync(path.join(root,item.image))))console.log(JSON.stringify(item));
const missing=result.filter(item=>!item.image || !fs.existsSync(path.join(root,item.image)));
console.log(JSON.stringify({total:result.length,missing:missing.length}));
if(missing.length) process.exitCode=1;
