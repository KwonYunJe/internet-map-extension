// Plan once per layout. Animation only follows the cached cubic control recipe.
function routeCubicPoint(points, t) {
  const u = 1 - t;
  return {x: u*u*u*points[0].x + 3*u*u*t*points[1].x + 3*u*t*t*points[2].x + t*t*t*points[3].x,
    y: u*u*u*points[0].y + 3*u*u*t*points[1].y + 3*u*t*t*points[2].y + t*t*t*points[3].y};
}

function routeControls(source, target, route, live = false) {
  const x = node => live ? node.renderX ?? node.screenX : node.screenX;
  const y = node => live ? node.renderY ?? node.screenY : node.screenY;
  const radius = node => live ? node.renderRadius ?? node.screenRadius : node.screenRadius;
  const angle = Math.atan2(y(target)-y(source), x(target)-x(source));
  const distance = Math.hypot(x(target)-x(source), y(target)-y(source));
  const startAngle = angle + route.startAngle, endAngle = angle + Math.PI + route.endAngle;
  const start = {x: x(source)+Math.cos(startAngle)*(radius(source)+1.5),
    y: y(source)+Math.sin(startAngle)*(radius(source)+1.5)};
  const end = {x: x(target)+Math.cos(endAngle)*(radius(target)+1.5),
    y: y(target)+Math.sin(endAngle)*(radius(target)+1.5)};
  const reach = Math.max(12, distance-radius(source)-radius(target)) * 0.32;
  const nx = -Math.sin(angle), ny = Math.cos(angle);
  return [start,
    {x: start.x+Math.cos(startAngle)*reach+nx*distance*route.bend,
      y: start.y+Math.sin(startAngle)*reach+ny*distance*route.bend},
    {x: end.x+Math.cos(endAngle)*reach+nx*distance*route.bend,
      y: end.y+Math.sin(endAngle)*reach+ny*distance*route.bend}, end];
}

function routeClearance(points, obstacles) {
  let penalty = 0;
  let previous = points[0];
  for (let i=1; i<=32; i++) {
    const next = routeCubicPoint(points, i/32);
    const dx=next.x-previous.x, dy=next.y-previous.y;
    for (const node of obstacles) {
      const t=Math.max(0,Math.min(1,((node.screenX-previous.x)*dx+(node.screenY-previous.y)*dy)/(dx*dx+dy*dy || 1)));
      const distance=Math.hypot(node.screenX-previous.x-t*dx,node.screenY-previous.y-t*dy);
      // Reserve space for the frame, glow and ordinary wobble.
      const penetration=node.screenRadius*1.12+14-distance;
      if (penetration>0) penalty += penetration*penetration;
    }
    previous=next;
  }
  return penalty;
}

function prepareEdgeRoutes(pairs, nodes, bounds = {}) {
  const ports = new Map(nodes.map(node => [node, []]));
  for (const pair of pairs) if (pair.nodeA && pair.nodeB) {
    ports.get(pair.nodeA).push({pair, other: pair.nodeB, key: 'startAngle'});
    ports.get(pair.nodeB).push({pair, other: pair.nodeA, key: 'endAngle'});
    pair.route = {};
  }
  for (const [node, entries] of ports) {
    entries.sort((a,b) => Math.atan2(a.other.screenY-node.screenY,a.other.screenX-node.screenX) -
      Math.atan2(b.other.screenY-node.screenY,b.other.screenX-node.screenX) ||
      a.other.domain.localeCompare(b.other.domain));
    entries.forEach((entry,index) => {
      entry.pair.route[entry.key] = entries.length < 2 ? 0 : (index/(entries.length-1)-0.5)*0.5;
    });
  }
  for (const pair of pairs) {
    if (!pair.route) continue;
    const obstacles=nodes.filter(node => node!==pair.nodeA && node!==pair.nodeB);
    let best=null, bestScore=Infinity;
    for (const bend of [0.16,-0.16,0.26,-0.26,0.4,-0.4,0.6,-0.6,0.85,-0.85]) {
      const candidate={...pair.route,bend};
      const points=routeControls(pair.nodeA,pair.nodeB,candidate);
      const collision=routeClearance(points,obstacles);
      let outside=0;
      for (let i=1;i<32;i++) {
        const point=routeCubicPoint(points,i/32);
        outside+=Math.max(0,8-point.x)**2+Math.max(0,8-point.y)**2+
          Math.max(0,point.x-(bounds.width??Infinity)+8)**2+
          Math.max(0,point.y-(bounds.height??Infinity)+8)**2;
      }
      const score=collision*10000+outside*10000+Math.abs(bend);
      if (score<bestScore) { best=candidate; bestScore=score; best.clearancePenalty=collision; }
    }
    pair.route=best;
    pair.geometryKey=null;
  }
}

function createRoutedRibbonPath(source, target, route, startWidth, endWidth, laneOffset, reverse) {
  if (!source || !target) return '';
  const distance=Math.hypot((target.renderX??target.screenX)-(source.renderX??source.screenX),
    (target.renderY??target.screenY)-(source.renderY??source.screenY));
  if (distance <= (source.renderRadius??source.screenRadius)+(target.renderRadius??target.screenRadius)+2) return '';
  const recipe=reverse ? {...route,startAngle:route.endAngle,endAngle:route.startAngle,bend:-route.bend} : route;
  const points=routeControls(source,target,recipe,true);
  const startHalf=Math.min(startWidth/2,(source.renderRadius??source.screenRadius)*0.25);
  const endHalf=Math.min(endWidth/2,startHalf*0.42);
  const widths=[startHalf,startHalf*0.55,endHalf*1.4,endHalf];
  const side=sign => points.map((point,index) => {
    const before=points[Math.max(0,index-1)], after=points[Math.min(3,index+1)];
    const dx=after.x-before.x,dy=after.y-before.y,length=Math.hypot(dx,dy)||1;
    const offset=sign*widths[index]+laneOffset*(1-index/3*0.65);
    return `${point.x-dy/length*offset} ${point.y+dx/length*offset}`;
  });
  const top=side(1),bottom=side(-1);
  return `M ${top[0]} C ${top[1]} ${top[2]} ${top[3]} L ${bottom[3]} C ${bottom[2]} ${bottom[1]} ${bottom[0]} Z`;
}

if (typeof module !== 'undefined') module.exports={prepareEdgeRoutes,routeControls,routeClearance,createRoutedRibbonPath};
