// A dollar-quoted PL/pgSQL body must remain one prepared SQL statement.
export function sqlStatements(source) {
  const statements=[];let start=0,quote='',dollar='',comment=false;
  for(let i=0;i<source.length;i++) {
    const c=source[i],next=source[i+1];
    if(comment){if(c==='\n')comment=false;continue;}
    if(dollar){if(source.startsWith(dollar,i)){i+=dollar.length-1;dollar='';}continue;}
    if(quote){if(c===quote){if(next===quote)i++;else quote='';}continue;}
    if(c==='-' && next==='-'){comment=true;i++;continue;}
    if(c==="'" || c==='"'){quote=c;continue;}
    if(c==='$'){const tag=source.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/)?.[0];if(tag){dollar=tag;i+=tag.length-1;continue;}}
    if(c===';'){const part=source.slice(start,i).trim();if(part)statements.push(part);start=i+1;}
  }
  if(quote || dollar)throw new Error('Unterminated SQL schema literal.');
  const tail=source.slice(start).trim();if(tail && tail.replace(/--[^\n]*/g,'').trim())statements.push(tail);
  return statements;
}
