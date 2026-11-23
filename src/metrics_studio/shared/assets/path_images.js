/* Source images stay outside the report. Resolve paths for the viewing OS;
 * failed paths are unavailable, never replaced with embedded image bytes. */
(function(host){
  "use strict";
  function resolvePath(value,base,windows=false){
    if(!value||/^(data|blob|javascript):/i.test(value))return null;
    try{
      const source=new URL(value,base),report=new URL(base);
      if(source.protocol!=="file:")return null;
      if(windows&&!source.hostname){
        const drive=source.pathname.match(/^\/mnt\/([a-z])\//i);
        if(drive)return "file:///"+drive[1].toUpperCase()+":"+source.pathname.slice(6);
        if(!/^\/[a-z]:\//i.test(source.pathname)&&/^wsl\.(localhost|\$)$/i.test(report.hostname)){
          const distribution=report.pathname.split("/")[1];
          if(distribution)return "file://"+report.hostname+"/"+distribution+source.pathname;
        }
      }
      return source.href;
    }catch(_error){return null;}
  }
  function imageSource(value){return resolvePath(value,host.location.href,/^win/i.test(host.navigator.platform||""));}
  host.DM_PATH_IMAGES={resolvePath,imageSource};
})(typeof window==="undefined"?globalThis:window);
