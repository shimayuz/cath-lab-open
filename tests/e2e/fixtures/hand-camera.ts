import type { Page } from "@playwright/test";
export async function mockHandCamera(page: Page, fps = 25) {
  await page.addInitScript((fps) => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    setInterval(() => {
      ctx.fillStyle = "#eef3f5";
      ctx.fillRect(0, 0, 640, 480);
    }, 1000 / fps);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => canvas.captureStream(fps),
    });
  }, fps);
  await page.route(
    /\/node_modules\/\.vite\/deps\/@mediapipe_tasks-vision\.js/,
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `
    export const FilesetResolver={forVisionTasks:async()=>({})};
    export const HandLandmarker={createFromOptions:async()=>({close(){},detectForVideo(video,time){
      window.__detectorCalls=(window.__detectorCalls ?? 0)+1;
      const c=window.__motion ??= {tick:0,steps:0,leftY:.6,rightY:.6,leftAngle:0,rightAngle:0,pinch:true};
      c.tick=Math.min(c.steps,c.tick+1);
      function hand(x,y,a,pinch,roll=0) {
        const r=a*Math.PI/180;
        const pts=Array.from({length:21},(_,i)=>({x:i===0?0:(i%4)*.004,y:-i*.008,z:0}));
        pts[8]=pinch?{...pts[4],x:pts[4].x+.003}:{x:.14,y:-.06,z:0};
        if(pinch) {
          const axis=pts[9];
          for(const key of ['x','y','z']) {pts[4][key]+=axis[key]*roll/2;pts[8][key]-=axis[key]*roll/2;}
        }
        return pts.map(p=>({x:x+p.x*Math.cos(r)+p.y*Math.sin(r),y:y-p.x*Math.sin(r)+p.y*Math.cos(r),z:0}));
      }
      const jitter=(window.__detectorCalls % 2 ? 1 : -1);
      const left=hand((c.leftX ?? .75)+(c.leftDX||0)*c.tick+(c.leftNoise||0)*jitter,c.leftY+(c.leftDY||0)*c.tick,c.leftAngle+(c.leftDA||0)*c.tick,c.pinch,(c.leftRoll||0)+(c.leftRollD||0)*c.tick);
      const right=hand(.25,c.rightY+(c.rightDY||0)*c.tick,c.rightAngle+(c.rightDA||0)*c.tick+(c.angleNoise||0)*jitter,c.pinch,(c.rightRoll||0)+(c.rightRollD||0)*c.tick+(c.rollNoise||0)*jitter);
      return {landmarks:[right,left],worldLandmarks:c.noWorld?[]:[right,left],handedness:[[{categoryName:'Right',score:.99}],[{categoryName:'Left',score:.99}]]};
    }})};`,
      }),
  );
}
