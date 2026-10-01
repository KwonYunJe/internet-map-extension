const svg =
  document.querySelector("#network");

const summaryElement =
  document.querySelector("#summary");

const detailElement =
  document.querySelector("#detail");

const rankingListElement =
  document.querySelector("#rankingList");


const SVG_NS =
  "http://www.w3.org/2000/svg";


const WIDTH = 1200;
const HEIGHT = 700;


// ==================================================
// Shallow 3D
// ==================================================

const Z_MIN = -30;
const Z_MAX = 30;

const CAMERA_DISTANCE = 700;

const HOVER_Z = 90;

const HOVER_DEPTH_EASING =
  0.18;


// ==================================================
// Canvas-filling XY layout volume
// ==================================================

/*
 * SVG 프레임은 1200 x 700이다.
 *
 * 이전에는 노드의 XY 배치 영역 자체를 4:3으로 제한했기 때문에
 * 프레임 좌우에 사용되지 않는 공간이 많이 남았다.
 *
 * 이제는 캔버스의 실제 비율을 최대한 활용한다.
 * 단, 노드 본체와 hover glow가 프레임 밖으로 잘리지 않도록
 * layout 단계와 screen-space projection 단계에서 각각 안전 여백을 둔다.
 */
const LAYOUT_MARGIN_X =
  18;

const LAYOUT_MARGIN_Y =
  18;


const LAYOUT_HALF_WIDTH =
  WIDTH / 2 -
  LAYOUT_MARGIN_X;

const LAYOUT_HALF_HEIGHT =
  HEIGHT / 2 -
  LAYOUT_MARGIN_Y;


/*
 * 배치 경계 모양.
 *
 * 2   -> ellipse
 * 3.2 -> rounded rectangle에 가까운 superellipse
 *
 * 너무 사각형처럼 보이지 않으면서도
 * 좌우 / 코너 영역을 기존보다 적극적으로 사용할 수 있다.
 */
const LAYOUT_SHAPE_POWER =
  3.2;


/*
 * 중요도가 높은 노드는 중심에 가깝게,
 * 중요도가 낮은 노드는 외곽까지 넓게 분산한다.
 */
const CENTER_MIN_RADIUS_RATIO =
  0.055;

const CENTER_MAX_RADIUS_RATIO =
  0.985;


/*
 * 노드 중심을 layout volume 안에 제한할 때 사용하는
 * 안전 반경 배수.
 */
const NODE_SAFE_RADIUS_FACTOR =
  1.24;


/*
 * 최종 screen-space에서 확보할 여백.
 */
const CANVAS_NODE_MARGIN =
  10;


/*
 * hover 시 z = HOVER_Z까지 앞으로 나온 상태의
 * 최대 projection scale.
 *
 * 이 값을 이용해서 hover 중에도
 * 노드가 캔버스 밖으로 잘리지 않도록 한다.
 */
const MAX_HOVER_PROJECTION_SCALE =
  CAMERA_DISTANCE /
  (
    CAMERA_DISTANCE -
    HOVER_Z
  );


// ==================================================
// Importance
// ==================================================

const IMPORTANCE_ACTIVE_TIME_WEIGHT =
  0.55;

const IMPORTANCE_SESSION_WEIGHT =
  0.30;

const IMPORTANCE_TRANSITION_WEIGHT =
  0.15;


const NODE_MIN_RADIUS =
  18;

const NODE_MAX_RADIUS =
  96;


const NODE_SIZE_CURVE =
  1.7;


const LABEL_MIN_FONT_SIZE =
  11;

const LABEL_MAX_FONT_SIZE =
  22;


// ==================================================
// Edge
// ==================================================

const EDGE_END_WIDTH =
  1;

const EDGE_WIDTH_PER_TRANSITION =
  2.5;

const EDGE_MAX_START_WIDTH =
  42;


// ==================================================
// Animation / pointer state
// ==================================================

const WOBBLE_ENABLED =
  true;


let animationFrameId =
  null;


let hoveredNode =
  null;


let pointerDownNode =
  null;


let pointerDownPoint =
  null;


// ==================================================
// Data
// ==================================================

function loadSessions() {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      chrome.runtime.sendMessage(
        {
          type:
            "GET_SESSIONS"
        },

        response => {

          if (
            chrome.runtime.lastError
          ) {

            reject(
              chrome.runtime.lastError
            );

            return;
          }


          if (
            response?.error
          ) {

            reject(
              new Error(
                response.error
              )
            );

            return;
          }


          resolve(
            response?.sessions ??
            []
          );
        }
      );
    }
  );
}


// ==================================================
// Sessions → Graph
// ==================================================

function aggregateSessions(
  sessions
) {

  const nodeMap =
    new Map();


  const edgeMap =
    new Map();


  for (
    const session
    of sessions
  ) {

    let node =
      nodeMap.get(
        session.domain
      );


    if (!node) {

      node = {

        domain:
          session.domain,


        faviconPageUrl:
          null,

        faviconUrl:
          null,


        activeTime:
          0,

        sessionCount:
          0,

        transitionCount:
          0,


        rawImportance:
          0,

        importance:
          0,


        x: 0,
        y: 0,
        z: 0,


        vx: 0,
        vy: 0,
        vz: 0,


        radius:
          0,


        screenX:
          0,

        screenY:
          0,

        screenRadius:
          0,

        baseProjectionScale:
          1,


        renderX:
          0,

        renderY:
          0,

        renderRadius:
          0,

        renderZ:
          0,


        depthOpacity:
          1,


        wobbleAmplitude:
          0,

        wobbleSpeedX:
          0,

        wobbleSpeedY:
          0,

        wobblePhaseX:
          0,

        wobblePhaseY:
          0,


        hovered:
          false,

        hoverProgress:
          0,


        /*
         * hover가 시작된 순간의 screen-space 중심 좌표.
         *
         * z축으로 앞으로 나오는 동안에도
         * 이 x / y를 유지해서 노드가 마우스 아래에서
         * 옆으로 밀려나지 않게 한다.
         */
        hoverAnchorX:
          null,

        hoverAnchorY:
          null,


        labelFontSize:
          LABEL_MIN_FONT_SIZE,


        domGroup:
          null,

        inHoverLayer:
          false
      };


      nodeMap.set(
        session.domain,
        node
      );
    }


    node.activeTime +=
      session.duration ??
      0;


    node.sessionCount +=
      1;


    if (
      session.faviconPageUrl
    ) {

      node.faviconPageUrl =
        session.faviconPageUrl;
    }


    if (
      session.faviconUrl
    ) {

      node.faviconUrl =
        session.faviconUrl;
    }


    if (
      session.fromDomain &&
      session.fromDomain !==
        session.domain
    ) {

      const key =
        `${session.fromDomain}→${session.domain}`;


      let edge =
        edgeMap.get(
          key
        );


      if (!edge) {

        edge = {

          source:
            session.fromDomain,

          target:
            session.domain,

          count:
            0
        };


        edgeMap.set(
          key,
          edge
        );
      }


      edge.count +=
        1;
    }
  }


  return {

    nodes:
      Array.from(
        nodeMap.values()
      ),


    edges:
      Array.from(
        edgeMap.values()
      )
  };
}


// ==================================================
// Formatting
// ==================================================

function formatDuration(
  ms
) {

  const totalSeconds =
    Math.max(
      0,

      Math.round(
        ms /
        1000
      )
    );


  if (
    totalSeconds <
    60
  ) {

    return `${totalSeconds}초`;
  }


  const minutes =
    Math.floor(
      totalSeconds /
      60
    );


  const seconds =
    totalSeconds %
    60;


  if (
    minutes <
    60
  ) {

    return `${minutes}분 ${seconds}초`;
  }


  const hours =
    Math.floor(
      minutes /
      60
    );


  const remainingMinutes =
    minutes %
    60;


  return `${hours}시간 ${remainingMinutes}분`;
}


function normalizeValue(
  value,
  min,
  max
) {

  if (
    max <=
    min
  ) {

    return 0.5;
  }


  return (
    value -
    min
  ) /
  (
    max -
    min
  );
}


// ==================================================
// Importance
// ==================================================

function calculateNodeImportance(
  nodes,
  edges
) {

  if (
    nodes.length ===
    0
  ) {

    return;
  }


  const transitionMap =
    new Map(
      nodes.map(
        node => [
          node.domain,
          0
        ]
      )
    );


  for (
    const edge
    of edges
  ) {

    transitionMap.set(
      edge.source,

      (
        transitionMap.get(
          edge.source
        ) ??
        0
      ) +
      edge.count
    );


    transitionMap.set(
      edge.target,

      (
        transitionMap.get(
          edge.target
        ) ??
        0
      ) +
      edge.count
    );
  }


  const activeTimes =
    nodes.map(
      node =>
        node.activeTime
    );


  const sessionCounts =
    nodes.map(
      node =>
        node.sessionCount
    );


  const transitionCounts =
    nodes.map(
      node =>
        transitionMap.get(
          node.domain
        ) ??
        0
    );


  const minActiveTime =
    Math.min(
      ...activeTimes
    );


  const maxActiveTime =
    Math.max(
      ...activeTimes
    );


  const minSessionCount =
    Math.min(
      ...sessionCounts
    );


  const maxSessionCount =
    Math.max(
      ...sessionCounts
    );


  const minTransitionCount =
    Math.min(
      ...transitionCounts
    );


  const maxTransitionCount =
    Math.max(
      ...transitionCounts
    );


  for (
    const node
    of nodes
  ) {

    const transitionCount =
      transitionMap.get(
        node.domain
      ) ??
      0;


    const activeScore =
      normalizeValue(
        node.activeTime,
        minActiveTime,
        maxActiveTime
      );


    const sessionScore =
      normalizeValue(
        node.sessionCount,
        minSessionCount,
        maxSessionCount
      );


    const transitionScore =
      normalizeValue(
        transitionCount,
        minTransitionCount,
        maxTransitionCount
      );


    node.transitionCount =
      transitionCount;


    node.rawImportance =
      activeScore *
        IMPORTANCE_ACTIVE_TIME_WEIGHT
      +
      sessionScore *
        IMPORTANCE_SESSION_WEIGHT
      +
      transitionScore *
        IMPORTANCE_TRANSITION_WEIGHT;
  }


  const rawValues =
    nodes.map(
      node =>
        node.rawImportance
    );


  const minRaw =
    Math.min(
      ...rawValues
    );


  const maxRaw =
    Math.max(
      ...rawValues
    );


  for (
    const node
    of nodes
  ) {

    node.importance =
      nodes.length ===
      1

        ? 1

        : normalizeValue(
            node.rawImportance,
            minRaw,
            maxRaw
          );
  }
}


function calculateNodeRadius(
  importance
) {

  const curved =
    Math.pow(
      importance,
      NODE_SIZE_CURVE
    );


  return (
    NODE_MIN_RADIUS
    +
    curved *
    (
      NODE_MAX_RADIUS -
      NODE_MIN_RADIUS
    )
  );
}


function calculateLabelFontSize(
  importance
) {

  return (
    LABEL_MIN_FONT_SIZE
    +
    importance *
    (
      LABEL_MAX_FONT_SIZE -
      LABEL_MIN_FONT_SIZE
    )
  );
}


function calculatePreferredRadiusRatio(
  importance
) {

  /*
   * 중요도가 높은 노드는 이전보다 더 강하게 중심으로 모은다.
   *
   * 반대로 중요도가 낮은 노드는 기존처럼 외곽 공간을
   * 충분히 사용하도록 importance에 따라 exponent를 바꾼다.
   */
  const exponent =
    0.78
    +
    (
      1 -
      importance
    ) *
    0.45;


  const curved =
    Math.pow(
      importance,
      exponent
    );


  return (
    CENTER_MIN_RADIUS_RATIO
    +
    (
      1 -
      curved
    ) *
    (
      CENTER_MAX_RADIUS_RATIO -
      CENTER_MIN_RADIUS_RATIO
    )
  );
}


function calculateNodeMobility(
  node
) {

  return (
    1 /
    (
      1 +
      node.importance *
      2.5
    )
  );
}


// ==================================================
// Layout Helpers
// ==================================================

function domainHash(
  value
) {

  let hash =
    2166136261;


  for (
    let i = 0;
    i < value.length;
    i++
  ) {

    hash ^=
      value.charCodeAt(
        i
      );


    hash =
      Math.imul(
        hash,
        16777619
      );
  }


  return (
    (hash >>> 0) /
    4294967295
  );
}


function createLayoutEdges(
  edges
) {

  const relationMap =
    new Map();


  for (
    const edge
    of edges
  ) {

    const domains =
      [
        edge.source,
        edge.target
      ].sort();


    const key =
      `${domains[0]}↔${domains[1]}`;


    let relation =
      relationMap.get(
        key
      );


    if (!relation) {

      relation = {

        source:
          domains[0],

        target:
          domains[1],

        count:
          0
      };


      relationMap.set(
        key,
        relation
      );
    }


    relation.count +=
      edge.count;
  }


  return Array.from(
    relationMap.values()
  );
}


function constrainNodeToLayoutVolume(
  node
) {

  const centerX =
    WIDTH /
    2;


  const centerY =
    HEIGHT /
    2;


  const safeRadius =
    node.radius *
    NODE_SAFE_RADIUS_FACTOR;


  const usableHalfX =
    Math.max(
      40,

      LAYOUT_HALF_WIDTH -
      safeRadius
    );


  const usableHalfY =
    Math.max(
      40,

      LAYOUT_HALF_HEIGHT -
      safeRadius
    );


  let dx =
    node.x -
    centerX;


  let dy =
    node.y -
    centerY;


  /*
   * Superellipse:
   *
   * |x/a|^p + |y/b|^p <= 1
   *
   * p = 2   -> ellipse
   * p > 2   -> rounded rectangle
   */
  const normalizedX =
    Math.abs(
      dx
    ) /
    usableHalfX;


  const normalizedY =
    Math.abs(
      dy
    ) /
    usableHalfY;


  const volumeValue =
    Math.pow(
      normalizedX,
      LAYOUT_SHAPE_POWER
    )
    +
    Math.pow(
      normalizedY,
      LAYOUT_SHAPE_POWER
    );


  if (
    volumeValue >
    1
  ) {

    /*
     * 현재 방향은 유지하면서
     * superellipse 경계 안쪽으로 축소한다.
     */
    const factor =
      Math.pow(
        volumeValue,

        -1 /
        LAYOUT_SHAPE_POWER
      );


    dx *=
      factor;


    dy *=
      factor;


    node.x =
      centerX +
      dx;


    node.y =
      centerY +
      dy;
  }


  node.z =
    Math.max(
      Z_MIN,

      Math.min(
        Z_MAX,
        node.z
      )
    );
}


// ==================================================
// Force Layout
// ==================================================

function createForceLayout(
  nodes,
  edges
) {

  if (
    nodes.length ===
    0
  ) {

    return;
  }


  const centerX =
    WIDTH /
    2;


  const centerY =
    HEIGHT /
    2;


  calculateNodeImportance(
    nodes,
    edges
  );


  for (
    const node
    of nodes
  ) {

    node.radius =
      calculateNodeRadius(
        node.importance
      );


    node.labelFontSize =
      calculateLabelFontSize(
        node.importance
      );
  }


  // ==================================================
  // Initial position
  // ==================================================

  for (
    const node
    of nodes
  ) {

    const angle =
      domainHash(
        `${node.domain}:layout-angle`
      ) *
      Math.PI *
      2;


    const radiusRatio =
      calculatePreferredRadiusRatio(
        node.importance
      );


    /*
     * 초기 위치부터 superellipse의 방향별 경계를 사용한다.
     *
     * 따라서 첫 배치부터 ellipse 안쪽에만 모이지 않고
     * 캔버스 좌우 / 코너 영역을 더 적극적으로 활용한다.
     */
    const directionX =
      Math.cos(
        angle
      );


    const directionY =
      Math.sin(
        angle
      );


    const boundaryScale =
      Math.pow(
        Math.pow(
          Math.abs(
            directionX
          ),
          LAYOUT_SHAPE_POWER
        )
        +
        Math.pow(
          Math.abs(
            directionY
          ),
          LAYOUT_SHAPE_POWER
        ),

        -1 /
        LAYOUT_SHAPE_POWER
      );


    node.x =
      centerX
      +
      directionX *
      boundaryScale *
      LAYOUT_HALF_WIDTH *
      radiusRatio;


    node.y =
      centerY
      +
      directionY *
      boundaryScale *
      LAYOUT_HALF_HEIGHT *
      radiusRatio;


    node.z =
      Z_MIN
      +
      domainHash(
        node.domain
      ) *
      (
        Z_MAX -
        Z_MIN
      );


    node.vx =
      0;

    node.vy =
      0;

    node.vz =
      0;


    constrainNodeToLayoutVolume(
      node
    );
  }


  const nodeMap =
    new Map(
      nodes.map(
        node => [
          node.domain,
          node
        ]
      )
    );


  const layoutEdges =
    createLayoutEdges(
      edges
    );


  const iterations =
    700;


  for (
    let iteration = 0;
    iteration < iterations;
    iteration++
  ) {

    // ==================================================
    // Repulsion
    // ==================================================

    for (
      let i = 0;
      i < nodes.length;
      i++
    ) {

      for (
        let j = i + 1;
        j < nodes.length;
        j++
      ) {

        const a =
          nodes[i];


        const b =
          nodes[j];


        let dx =
          b.x -
          a.x;


        let dy =
          b.y -
          a.y;


        let dz =
          (
            b.z -
            a.z
          ) *
          3;


        let distanceSquared =
          dx * dx
          +
          dy * dy
          +
          dz * dz;


        if (
          distanceSquared <
          1
        ) {

          dx =
            1;

          dy =
            0;

          dz =
            0;


          distanceSquared =
            1;
        }


        const distance =
          Math.sqrt(
            distanceSquared
          );


        const sizeFactor =
          (
            a.radius +
            b.radius
          ) /
          2;


        const force =
          (
            19000 +
            sizeFactor *
            170
          ) /
          distanceSquared;


        const fx =
          (
            dx /
            distance
          ) *
          force;


        const fy =
          (
            dy /
            distance
          ) *
          force;


        const fz =
          (
            (
              dz /
              distance
            ) *
            force
          ) /
          3;


        const mobilityA =
          calculateNodeMobility(
            a
          );


        const mobilityB =
          calculateNodeMobility(
            b
          );


        a.vx -=
          fx *
          mobilityA;


        a.vy -=
          fy *
          mobilityA;


        a.vz -=
          fz *
          mobilityA;


        b.vx +=
          fx *
          mobilityB;


        b.vy +=
          fy *
          mobilityB;


        b.vz +=
          fz *
          mobilityB;
      }
    }


    // ==================================================
    // Spring
    // ==================================================

    for (
      const edge
      of layoutEdges
    ) {

      const source =
        nodeMap.get(
          edge.source
        );


      const target =
        nodeMap.get(
          edge.target
        );


      if (
        !source ||
        !target
      ) {

        continue;
      }


      const dx =
        target.x -
        source.x;


      const dy =
        target.y -
        source.y;


      const dz =
        (
          target.z -
          source.z
        ) *
        3;


      const distance =
        Math.max(
          Math.sqrt(
            dx * dx
            +
            dy * dy
            +
            dz * dz
          ),

          1
        );


      const relationshipBonus =
        Math.min(
          Math.log2(
            edge.count +
            1
          ) *
          20,

          65
        );


      const desiredDistance =
        source.radius
        +
        target.radius
        +
        120
        -
        relationshipBonus;


      const strength =
        0.003
        +
        Math.min(
          edge.count,
          12
        ) *
        0.001;


      const force =
        (
          distance -
          desiredDistance
        ) *
        strength;


      const fx =
        (
          dx /
          distance
        ) *
        force;


      const fy =
        (
          dy /
          distance
        ) *
        force;


      const fz =
        (
          (
            dz /
            distance
          ) *
          force
        ) /
        3;


      const sourceMobility =
        calculateNodeMobility(
          source
        );


      const targetMobility =
        calculateNodeMobility(
          target
        );


      source.vx +=
        fx *
        sourceMobility;


      source.vy +=
        fy *
        sourceMobility;


      source.vz +=
        fz *
        sourceMobility;


      target.vx -=
        fx *
        targetMobility;


      target.vy -=
        fy *
        targetMobility;


      target.vz -=
        fz *
        targetMobility;
    }


    // ==================================================
    // Collision
    // ==================================================

    for (
      let i = 0;
      i < nodes.length;
      i++
    ) {

      for (
        let j = i + 1;
        j < nodes.length;
        j++
      ) {

        const a =
          nodes[i];


        const b =
          nodes[j];


        let dx =
          b.x -
          a.x;


        let dy =
          b.y -
          a.y;


        let distance =
          Math.sqrt(
            dx * dx +
            dy * dy
          );


        if (
          distance <
          1
        ) {

          distance =
            1;


          dx =
            1;


          dy =
            0;
        }


        const baseMinimum =
          a.radius
          +
          b.radius
          +
          26;


        const depthRelief =
          Math.min(
            Math.abs(
              a.z -
              b.z
            ) *
            0.65,

            baseMinimum *
            0.25
          );


        const minimumDistance =
          baseMinimum -
          depthRelief;


        if (
          distance <
          minimumDistance
        ) {

          const overlap =
            minimumDistance -
            distance;


          const push =
            overlap *
            0.10;


          const fx =
            (
              dx /
              distance
            ) *
            push;


          const fy =
            (
              dy /
              distance
            ) *
            push;


          const mobilityA =
            calculateNodeMobility(
              a
            );


          const mobilityB =
            calculateNodeMobility(
              b
            );


          a.vx -=
            fx *
            mobilityA;


          a.vy -=
            fy *
            mobilityA;


          b.vx +=
            fx *
            mobilityB;


          b.vy +=
            fy *
            mobilityB;
        }
      }
    }


    // ==================================================
    // Canvas-wide superellipse center attraction
    // ==================================================

    for (
      const node
      of nodes
    ) {

      const dx =
        node.x -
        centerX;


      const dy =
        node.y -
        centerY;


      /*
       * 캔버스 비율에 맞춰 정규화한 좌표.
       */
      const normalizedX =
        dx /
        LAYOUT_HALF_WIDTH;


      const normalizedY =
        dy /
        LAYOUT_HALF_HEIGHT;


      const normalizedDistance =
        Math.max(
          Math.sqrt(
            normalizedX *
            normalizedX
            +
            normalizedY *
            normalizedY
          ),

          0.0001
        );


      /*
       * 현재 방향을 유지한다.
       */
      const directionX =
        normalizedX /
        normalizedDistance;


      const directionY =
        normalizedY /
        normalizedDistance;


      /*
       * 이 방향에서 superellipse 경계까지 도달하기 위한
       * scale을 계산한다.
       *
       * |tx|^p + |ty|^p = 1
       */
      const boundaryScale =
        Math.pow(
          Math.pow(
            Math.abs(
              directionX
            ),
            LAYOUT_SHAPE_POWER
          )
          +
          Math.pow(
            Math.abs(
              directionY
            ),
            LAYOUT_SHAPE_POWER
          ),

          -1 /
          LAYOUT_SHAPE_POWER
        );


      const preferredRatio =
        calculatePreferredRadiusRatio(
          node.importance
        );


      /*
       * 중요도가 낮은 노드는 outer volume까지,
       * 중요도가 높은 노드는 중심에 가깝게.
       */
      const targetX =
        centerX
        +
        directionX *
        boundaryScale *
        LAYOUT_HALF_WIDTH *
        preferredRatio;


      const targetY =
        centerY
        +
        directionY *
        boundaryScale *
        LAYOUT_HALF_HEIGHT *
        preferredRatio;


      /*
       * 외곽 노드들이 넓어진 캔버스 영역을
       * 실제로 사용하도록 기본 복원력을 높인다.
       */
      const centerStrength =
        0.00135
        +
        node.importance *
        0.0015;


      node.vx +=
        (
          targetX -
          node.x
        ) *
        centerStrength;


      node.vy +=
        (
          targetY -
          node.y
        ) *
        centerStrength;


      /*
       * z는 기존처럼 얕은 깊이 범위의 중앙을 향해
       * 아주 약하게 안정화한다.
       */
      node.vz +=
        -node.z *
        0.001;
    }


    // ==================================================
    // Update
    // ==================================================

    for (
      const node
      of nodes
    ) {

      node.vx *=
        0.84;


      node.vy *=
        0.84;


      node.vz *=
        0.84;


      node.x +=
        node.vx;


      node.y +=
        node.vy;


      node.z +=
        node.vz;


      constrainNodeToLayoutVolume(
        node
      );
    }
  }
}


// ==================================================
// Projection
// ==================================================

function projectNodes(
  nodes
) {

  const centerX =
    WIDTH /
    2;


  const centerY =
    HEIGHT /
    2;


  /*
   * 1차 projection.
   *
   * 먼저 각 노드를 자신의 기본 z축 기준으로 투영한다.
   * 아직 screen-space clamp는 하지 않는다.
   */
  for (
    const node
    of nodes
  ) {

    const scale =
      CAMERA_DISTANCE /
      (
        CAMERA_DISTANCE -
        node.z
      );


    node.baseProjectionScale =
      scale;


    node.projectedX =
      centerX
      +
      (
        node.x -
        centerX
      ) *
      scale;


    node.projectedY =
      centerY
      +
      (
        node.y -
        centerY
      ) *
      scale;


    node.screenRadius =
      node.radius *
      scale;
  }


  /*
   * 시각적으로 가장 중요한 상위 3개 노드의 중심을
   * 실제 캔버스 중앙과 맞춘다.
   *
   * 내부 force-layout 자체를 억지로 고정하지 않고
   * 최종 투영 결과 전체를 같은 만큼 이동시키므로
   * 기존 edge 관계와 전체 그래프 형태는 그대로 유지된다.
   */
  const coreNodes =
    [...nodes]
      .sort(
        (
          a,
          b
        ) =>
          b.importance -
          a.importance
      )
      .slice(
        0,
        Math.min(
          3,
          nodes.length
        )
      );


  let coreWeightTotal =
    0;

  let coreCenterX =
    0;

  let coreCenterY =
    0;


  for (
    const node
    of coreNodes
  ) {

    /*
     * 가장 큰 노드가 중심 계산에 조금 더 큰 영향력을 갖는다.
     */
    const weight =
      1
      +
      node.importance *
      2;


    coreWeightTotal +=
      weight;


    coreCenterX +=
      node.projectedX *
      weight;


    coreCenterY +=
      node.projectedY *
      weight;
  }


  if (
    coreWeightTotal >
    0
  ) {

    coreCenterX /=
      coreWeightTotal;


    coreCenterY /=
      coreWeightTotal;
  } else {

    coreCenterX =
      centerX;


    coreCenterY =
      centerY;
  }


  const visualShiftX =
    centerX -
    coreCenterX;


  const visualShiftY =
    centerY -
    coreCenterY;


  /*
   * 2차 projection.
   *
   * core cluster를 중앙으로 옮긴 뒤
   * hover 최대 크기와 glow까지 고려해서
   * 모든 노드를 최종 screen-space 안에 제한한다.
   */
  for (
    const node
    of nodes
  ) {

    let projectedX =
      node.projectedX +
      visualShiftX;


    let projectedY =
      node.projectedY +
      visualShiftY;


    const maxHoverRadius =
      node.radius *
      MAX_HOVER_PROJECTION_SCALE;


    const maxVisualRadius =
      maxHoverRadius *
      1.10;


    const safeDistance =
      maxVisualRadius +
      CANVAS_NODE_MARGIN;


    projectedX =
      Math.max(
        safeDistance,

        Math.min(
          WIDTH -
          safeDistance,

          projectedX
        )
      );


    projectedY =
      Math.max(
        safeDistance,

        Math.min(
          HEIGHT -
          safeDistance,

          projectedY
        )
      );


    node.screenX =
      projectedX;


    node.screenY =
      projectedY;


    node.renderX =
      node.screenX;


    node.renderY =
      node.screenY;


    node.renderRadius =
      node.screenRadius;


    node.renderZ =
      node.z;


    node.hoverAnchorX =
      null;


    node.hoverAnchorY =
      null;


    const depthRatio =
      (
        node.z -
        Z_MIN
      ) /
      (
        Z_MAX -
        Z_MIN
      );


    node.depthOpacity =
      0.72
      +
      depthRatio *
      0.28;
  }
}


// ==================================================
// Edge
// ==================================================

function createEdgePairs(
  edges
) {

  const pairMap =
    new Map();


  for (
    const edge
    of edges
  ) {

    const domains =
      [
        edge.source,
        edge.target
      ].sort();


    const a =
      domains[0];


    const b =
      domains[1];


    const key =
      `${a}↔${b}`;


    let pair =
      pairMap.get(
        key
      );


    if (!pair) {

      pair = {
        a,
        b,

        aToB:
          0,

        bToA:
          0,

        aToBElement:
          null,

        bToAElement:
          null,

        nodeA:
          null,

        nodeB:
          null
      };


      pairMap.set(
        key,
        pair
      );
    }


    if (
      edge.source ===
      a
    ) {

      pair.aToB +=
        edge.count;

    } else {

      pair.bToA +=
        edge.count;
    }
  }


  return Array.from(
    pairMap.values()
  );
}


function calculateEdgeStartWidth(
  count
) {

  return Math.min(
    EDGE_END_WIDTH
    +
    count *
    EDGE_WIDTH_PER_TRANSITION,

    EDGE_MAX_START_WIDTH
  );
}


function createTaperedRibbonPath(
  source,
  target,
  startWidth,
  endWidth =
    EDGE_END_WIDTH
) {

  const sx =
    source.renderX ??
    source.screenX;


  const sy =
    source.renderY ??
    source.screenY;


  const tx =
    target.renderX ??
    target.screenX;


  const ty =
    target.renderY ??
    target.screenY;


  const sourceRadius =
    source.renderRadius ??
    source.screenRadius;


  const targetRadius =
    target.renderRadius ??
    target.screenRadius;


  const dx =
    tx -
    sx;


  const dy =
    ty -
    sy;


  const distance =
    Math.sqrt(
      dx * dx +
      dy * dy
    );


  if (
    distance <
    1
  ) {

    return "";
  }


  const ux =
    dx /
    distance;


  const uy =
    dy /
    distance;


  const nx =
    -uy;


  const ny =
    ux;


  const sourceX =
    sx
    +
    ux *
    (
      sourceRadius +
      1
    );


  const sourceY =
    sy
    +
    uy *
    (
      sourceRadius +
      1
    );


  const targetX =
    tx
    -
    ux *
    (
      targetRadius +
      1
    );


  const targetY =
    ty
    -
    uy *
    (
      targetRadius +
      1
    );


  const startHalf =
    startWidth /
    2;


  const endHalf =
    endWidth /
    2;


  return `
    M
    ${sourceX + nx * startHalf}
    ${sourceY + ny * startHalf}

    L
    ${targetX + nx * endHalf}
    ${targetY + ny * endHalf}

    L
    ${targetX - nx * endHalf}
    ${targetY - ny * endHalf}

    L
    ${sourceX - nx * startHalf}
    ${sourceY - ny * startHalf}

    Z
  `;
}


// ==================================================
// SVG Helper
// ==================================================

function createSvgElement(
  type
) {

  return document.createElementNS(
    SVG_NS,
    type
  );
}


// ==================================================
// Favicon
// ==================================================

function isDirectFaviconUsable(
  value
) {

  if (!value) {

    return false;
  }


  try {

    const url =
      new URL(
        value
      );


    return [
      "https:",
      "http:",
      "data:",
      "blob:",
      "chrome-extension:"
    ].includes(
      url.protocol
    );

  } catch {

    return false;
  }
}


function createChromeFaviconUrl(
  pageUrl,
  size = 64
) {

  const faviconUrl =
    new URL(
      chrome.runtime.getURL(
        "/_favicon/"
      )
    );


  faviconUrl.searchParams.set(
    "pageUrl",
    pageUrl
  );


  faviconUrl.searchParams.set(
    "size",
    String(
      size
    )
  );


  return faviconUrl.toString();
}


function getFaviconCandidates(
  node
) {

  const candidates =
    [];


  if (
    isDirectFaviconUsable(
      node.faviconUrl
    )
  ) {

    candidates.push(
      node.faviconUrl
    );
  }


  if (
    node.faviconPageUrl
  ) {

    candidates.push(
      createChromeFaviconUrl(
        node.faviconPageUrl
      )
    );
  }


  candidates.push(
    createChromeFaviconUrl(
      `https://${node.domain}`
    )
  );


  return [
    ...new Set(
      candidates
    )
  ];
}


function bindNodeFavicon(
  node,
  favicon,
  fallback,
  onLoaded
) {

  const candidates =
    getFaviconCandidates(
      node
    );


  let index =
    0;


  fallback.style.display =
    "";


  favicon.style.display =
    "none";


  function tryNext() {

    if (
      index >=
      candidates.length
    ) {

      favicon.style.display =
        "none";


      fallback.style.display =
        "";


      return;
    }


    const candidate =
      candidates[
        index++
      ];


    favicon.setAttribute(
      "href",
      candidate
    );


    favicon.style.display =
      "";
  }


  favicon.addEventListener(
    "load",
    () => {

      fallback.style.display =
        "none";


      onLoaded?.(
        favicon.getAttribute(
          "href"
        )
      );
    }
  );


  favicon.addEventListener(
    "error",
    () => {

      favicon.style.display =
        "none";


      tryNext();
    }
  );


  tryNext();
}


// ==================================================
// Dominant favicon color
// ==================================================

function extractDominantColor(
  image
) {

  const canvas =
    document.createElement(
      "canvas"
    );


  const size =
    32;


  const step =
    24;


  canvas.width =
    size;


  canvas.height =
    size;


  const context =
    canvas.getContext(
      "2d",
      {
        willReadFrequently:
          true
      }
    );


  if (!context) {

    return null;
  }


  context.clearRect(
    0,
    0,
    size,
    size
  );


  context.drawImage(
    image,
    0,
    0,
    size,
    size
  );


  const pixels =
    context.getImageData(
      0,
      0,
      size,
      size
    ).data;


  const buckets =
    new Map();


  for (
    let i = 0;
    i < pixels.length;
    i += 4
  ) {

    const alpha =
      pixels[
        i + 3
      ] /
      255;


    if (
      alpha <
      0.25
    ) {

      continue;
    }


    const r =
      pixels[i];


    const g =
      pixels[
        i + 1
      ];


    const b =
      pixels[
        i + 2
      ];


    const qr =
      Math.min(
        255,

        Math.round(
          r /
          step
        ) *
        step
      );


    const qg =
      Math.min(
        255,

        Math.round(
          g /
          step
        ) *
        step
      );


    const qb =
      Math.min(
        255,

        Math.round(
          b /
          step
        ) *
        step
      );


    const key =
      `${qr},${qg},${qb}`;


    let bucket =
      buckets.get(
        key
      );


    if (!bucket) {

      bucket = {

        count:
          0,

        r:
          0,

        g:
          0,

        b:
          0,

        weight:
          0
      };


      buckets.set(
        key,
        bucket
      );
    }


    bucket.count +=
      alpha;


    bucket.r +=
      r *
      alpha;


    bucket.g +=
      g *
      alpha;


    bucket.b +=
      b *
      alpha;


    bucket.weight +=
      alpha;
  }


  let best =
    null;


  for (
    const bucket
    of buckets.values()
  ) {

    if (
      !best ||
      bucket.count >
        best.count
    ) {

      best =
        bucket;
    }
  }


  if (
    !best ||
    best.weight <=
      0
  ) {

    return null;
  }


  return {

    r:
      Math.round(
        best.r /
        best.weight
      ),

    g:
      Math.round(
        best.g /
        best.weight
      ),

    b:
      Math.round(
        best.b /
        best.weight
      )
  };
}


function createBrandGradient(
  defs,
  index
) {

  const id =
    `brand-gradient-${index}`;


  const gradient =
    createSvgElement(
      "radialGradient"
    );


  gradient.setAttribute(
    "id",
    id
  );


  gradient.setAttribute(
    "cx",
    "50%"
  );


  gradient.setAttribute(
    "cy",
    "50%"
  );


  gradient.setAttribute(
    "r",
    "50%"
  );


  /*
   * 중심에서만 보이고
   * 바깥쪽은 완전히 투명하게.
   */
  const settings = [

    [0, 0.50],

    [24, 0.40],

    [52, 0.18],

    [76, 0.05],

    [100, 0]

  ];


  const stops =
    [];


  for (
    const [
      offset,
      opacity
    ]
    of settings
  ) {

    const stop =
      createSvgElement(
        "stop"
      );


    stop.setAttribute(
      "offset",
      `${offset}%`
    );


    stop.setAttribute(
      "stop-color",
      "#52668f"
    );


    stop.setAttribute(
      "stop-opacity",
      String(
        opacity
      )
    );


    gradient.appendChild(
      stop
    );


    stops.push(
      stop
    );
  }


  defs.appendChild(
    gradient
  );


  return {
    id,
    stops
  };
}


function applyBrandColor(
  node,
  gradientInfo,
  loadedUrl
) {

  const pageUrl =
    node.faviconPageUrl ??
    `https://${node.domain}`;


  const candidates = [

    createChromeFaviconUrl(
      pageUrl,
      64
    )

  ];


  if (
    loadedUrl?.startsWith(
      "data:"
    )
  ) {

    candidates.unshift(
      loadedUrl
    );
  }


  let index =
    0;


  function tryNext() {

    if (
      index >=
      candidates.length
    ) {

      return;
    }


    const image =
      new Image();


    const url =
      candidates[
        index++
      ];


    image.onload =
      () => {

        try {

          const color =
            extractDominantColor(
              image
            );


          if (!color) {

            tryNext();

            return;
          }


          const rgb =
            `rgb(${color.r} ${color.g} ${color.b})`;


          for (
            const stop
            of gradientInfo.stops
          ) {

            stop.setAttribute(
              "stop-color",
              rgb
            );
          }

        } catch {

          tryNext();
        }
      };


    image.onerror =
      tryNext;


    image.src =
      url;
  }


  tryNext();
}


// ==================================================
// Wobble
// ==================================================

function initializeNodeWobble(
  nodes
) {

  for (
    const node
    of nodes
  ) {

    node.wobbleAmplitude =
      3.5
      +
      domainHash(
        `${node.domain}:amp`
      ) *
      4.5;


    node.wobbleSpeedX =
      0.00045
      +
      domainHash(
        `${node.domain}:speedX`
      ) *
      0.00038;


    node.wobbleSpeedY =
      0.00038
      +
      domainHash(
        `${node.domain}:speedY`
      ) *
      0.00040;


    node.wobblePhaseX =
      domainHash(
        `${node.domain}:phaseX`
      ) *
      Math.PI *
      2;


    node.wobblePhaseY =
      domainHash(
        `${node.domain}:phaseY`
      ) *
      Math.PI *
      2;
  }
}


// ==================================================
// Pointer hit testing
// ==================================================

function getSvgPointerPosition(
  event
) {

  const point =
    svg.createSVGPoint();


  point.x =
    event.clientX;


  point.y =
    event.clientY;


  const ctm =
    svg.getScreenCTM();


  if (!ctm) {

    return null;
  }


  return point.matrixTransform(
    ctm.inverse()
  );
}


function findNodeAtPoint(
  nodes,
  x,
  y
) {

  /*
   * 이미 hover 중인 노드는 약간 더 넓은 영역에서
   * hover를 유지한다.
   *
   * 노드가 wobble 중이거나 경계에 포인터가 걸렸을 때
   * hover가 빠르게 켜졌다 꺼지는 현상을 줄인다.
   */
  if (
    hoveredNode
  ) {

    const dx =
      x -
      hoveredNode.renderX;


    const dy =
      y -
      hoveredNode.renderY;


    const stickyRadius =
      hoveredNode.renderRadius *
      1.22;


    if (
      dx * dx +
      dy * dy <=
      stickyRadius *
      stickyRadius
    ) {

      return hoveredNode;
    }
  }


  let bestNode =
    null;


  let bestZ =
    -Infinity;


  for (
    const node
    of nodes
  ) {

    const dx =
      x -
      node.renderX;


    const dy =
      y -
      node.renderY;


    const hitRadius =
      node.renderRadius *
      1.10;


    if (
      dx * dx +
      dy * dy >
      hitRadius *
      hitRadius
    ) {

      continue;
    }


    /*
     * 여러 노드가 겹쳐 있다면
     * 현재 화면상 가장 앞쪽의 노드를 선택한다.
     */
    const effectiveZ =
      node.renderZ ??
      node.z;


    if (
      effectiveZ >
      bestZ
    ) {

      bestZ =
        effectiveZ;


      bestNode =
        node;
    }
  }


  return bestNode;
}


function setHoveredNode(
  node,
  nodes,
  nodeLayer,
  hoverLayer
) {

  if (
    hoveredNode ===
    node
  ) {

    return;
  }


  /*
   * 이전 hover 노드는 즉시 일반 nodeLayer로 돌린다.
   *
   * 기존 구현처럼 fade가 끝날 때까지 hoverLayer에 남겨두면
   * 짧은 시간 동안 여러 노드가 최상단 레이어에 함께 존재할 수 있다.
   */
  if (
    hoveredNode
  ) {

    hoveredNode.hovered =
      false;


    hoveredNode.domGroup
      ?.classList
      .remove(
        "is-hovered"
      );


    if (
      hoveredNode.domGroup
    ) {

      nodeLayer.appendChild(
        hoveredNode.domGroup
      );


      hoveredNode.inHoverLayer =
        false;
    }
  }


  hoveredNode =
    node;


  /*
   * 일반 노드들의 SVG 순서를 다시 실제 z축 순서로 맞춘다.
   */
  restoreNodeLayerOrder(
    nodes,
    nodeLayer
  );


  if (!node) {

    return;
  }


  /*
   * hover가 시작된 순간의 실제 screen-space 위치를 저장한다.
   *
   * 앞으로 튀어나올 때는 크기와 z만 변하고
   * 중심 x / y는 이 위치에 고정된다.
   */
  node.hoverAnchorX =
    Number.isFinite(
      node.renderX
    )

      ? node.renderX

      : node.screenX;


  node.hoverAnchorY =
    Number.isFinite(
      node.renderY
    )

      ? node.renderY

      : node.screenY;


  node.hovered =
    true;


  node.domGroup
    ?.classList
    .add(
      "is-hovered"
    );


  /*
   * 현재 hover 노드는 전용 hoverLayer의 마지막 자식으로 이동한다.
   *
   * 따라서 원래 z값과 관계없이 다른 모든 노드보다
   * 항상 시각적으로 가장 앞에 그려진다.
   */
  if (
    node.domGroup
  ) {

    hoverLayer.appendChild(
      node.domGroup
    );


    node.inHoverLayer =
      true;
  }
}


function restoreNodeLayerOrder(
  nodes,
  nodeLayer
) {

  const normalNodes =
    [...nodes]

      .filter(
        node =>
          !node.hovered
      )

      .sort(
        (
          a,
          b
        ) =>
          a.z -
          b.z
      );


  for (
    const node
    of normalNodes
  ) {

    if (
      !node.domGroup
    ) {

      continue;
    }


    nodeLayer.appendChild(
      node.domGroup
    );


    node.inHoverLayer =
      false;
  }
}


// ==================================================
// Animation
// ==================================================

function startAnimation(
  nodes,
  edgePairs,
  nodeLayer,
  hoverLayer
) {

  if (
    animationFrameId
  ) {

    cancelAnimationFrame(
      animationFrameId
    );
  }


  initializeNodeWobble(
    nodes
  );


  let lastFrame =
    0;


  function animate(
    now
  ) {

    /*
     * 약 30 FPS로 업데이트한다.
     */
    if (
      now -
      lastFrame <
      33
    ) {

      animationFrameId =
        requestAnimationFrame(
          animate
        );


      return;
    }


    lastFrame =
      now;


    let needsOrderRestore =
      false;


    for (
      const node
      of nodes
    ) {

      // ==================================================
      // Hover depth
      // ==================================================

      const targetHover =
        node.hovered

          ? 1

          : 0;


      node.hoverProgress +=
        (
          targetHover -
          node.hoverProgress
        ) *
        HOVER_DEPTH_EASING;


      if (
        Math.abs(
          targetHover -
          node.hoverProgress
        ) <
        0.002
      ) {

        node.hoverProgress =
          targetHover;
      }


      /*
       * hover 시 z축만 앞으로 이동한다.
       *
       * x / y는 아래의 screen-space anchor를 사용하기 때문에
       * perspective projection으로 옆으로 밀리지 않는다.
       */
      const effectiveZ =
        node.z
        +
        (
          HOVER_Z -
          node.z
        ) *
        node.hoverProgress;


      node.renderZ =
        effectiveZ;


      /*
       * z축이 앞으로 나온 만큼
       * 크기만 perspective에 따라 증가한다.
       */
      const projectionScale =
        CAMERA_DISTANCE /
        (
          CAMERA_DISTANCE -
          effectiveZ
        );


      const scaleRatio =
        projectionScale /
        node.baseProjectionScale;


      // ==================================================
      // Normal wobble position
      // ==================================================

      /*
       * 기본 중심은 이미 projectNodes()에서 결정된
       * screenX / screenY다.
       *
       * 여기서 node.x / node.y를 effectiveZ로 다시 projection하면
       * hover할 때 중심에서 멀리 있는 노드가 옆으로 이동하게 된다.
       *
       * 따라서 animation 단계에서는
       * screen-space 위치에 wobble만 적용한다.
       */
      let freeX =
        node.screenX;


      let freeY =
        node.screenY;


      if (
        WOBBLE_ENABLED
      ) {

        freeX +=
          Math.sin(
            now *
            node.wobbleSpeedX
            +
            node.wobblePhaseX
          ) *
          node.wobbleAmplitude;


        freeY +=
          Math.cos(
            now *
            node.wobbleSpeedY
            +
            node.wobblePhaseY
          ) *
          node.wobbleAmplitude;
      }


      // ==================================================
      // Hover position lock
      // ==================================================

      /*
       * hover 시작 순간의 화면 좌표.
       *
       * hover 중에는 이 좌표로 자연스럽게 수렴한다.
       */
      const anchorX =
        Number.isFinite(
          node.hoverAnchorX
        )

          ? node.hoverAnchorX

          : node.screenX;


      const anchorY =
        Number.isFinite(
          node.hoverAnchorY
        )

          ? node.hoverAnchorY

          : node.screenY;


      /*
       * hoverProgress:
       *
       * 0 -> 평상시 wobble 위치
       * 1 -> hover 시작 순간의 x / y에 완전히 고정
       *
       * 그래서 노드가 갑자기 순간 이동하지 않고
       * 현재 위치에서 자연스럽게 멈춘다.
       */
      const x =
        freeX
        +
        (
          anchorX -
          freeX
        ) *
        node.hoverProgress;


      const y =
        freeY
        +
        (
          anchorY -
          freeY
        ) *
        node.hoverProgress;


      node.renderX =
        x;


      node.renderY =
        y;


      node.renderRadius =
        node.radius *
        projectionScale;


      /*
       * 뒤쪽 노드는 평상시에 약간 투명하지만,
       * hover되어 앞으로 나온 노드는 완전히 불투명하게 만든다.
       *
       * 이렇게 해야 아래에 있는 다른 노드가 glass 내부로
       * 과도하게 비쳐서 앞에 있는 것처럼 보이지 않는다.
       */
      const renderOpacity =
        node.depthOpacity
        +
        (
          1 -
          node.depthOpacity
        ) *
        node.hoverProgress;


      if (
        node.domGroup
      ) {

        node.domGroup.setAttribute(
          "opacity",
          String(
            renderOpacity
          )
        );
      }


      // ==================================================
      // DOM transform
      // ==================================================

      if (
        node.domGroup
      ) {

        node.domGroup.setAttribute(
          "transform",

          `
            translate(
              ${x}
              ${y}
            )

            scale(
              ${scaleRatio}
            )

            translate(
              ${-node.screenX}
              ${-node.screenY}
            )
          `
        );
      }


      // ==================================================
      // Restore layer order
      // ==================================================

      /*
       * hover가 끝나고 z 애니메이션이 거의 원상복구되면
       * 다시 원래 depth layer로 돌린다.
       */
      if (
        !node.hovered &&
        node.inHoverLayer &&
        node.hoverProgress <
          0.03
      ) {

        needsOrderRestore =
          true;


        /*
         * 다음 hover에서는 새 위치를 다시 저장한다.
         */
        node.hoverAnchorX =
          null;


        node.hoverAnchorY =
          null;
      }
    }


    /*
     * 현재 hover 노드는 매 frame hoverLayer의 마지막 자식으로 보장한다.
     *
     * SVG painter's order상 마지막 자식이 가장 위에 그려지므로
     * 겹친 노드가 있어도 focus 노드가 가려지지 않는다.
     */
    if (
      hoveredNode?.domGroup
    ) {

      hoverLayer.appendChild(
        hoveredNode.domGroup
      );


      hoveredNode.inHoverLayer =
        true;
    }


    if (
      needsOrderRestore
    ) {

      restoreNodeLayerOrder(
        nodes,
        nodeLayer
      );
    }


    // ==================================================
    // Edge animation
    // ==================================================

    /*
     * 노드는 wobble하고 hover 시 크기도 변하므로
     * edge도 현재 render 좌표를 따라 매 frame 다시 계산한다.
     */
    for (
      const pair
      of edgePairs
    ) {

      if (
        pair.aToBElement
      ) {

        pair.aToBElement.setAttribute(
          "d",

          createTaperedRibbonPath(
            pair.nodeA,
            pair.nodeB,

            calculateEdgeStartWidth(
              pair.aToB
            )
          )
        );
      }


      if (
        pair.bToAElement
      ) {

        pair.bToAElement.setAttribute(
          "d",

          createTaperedRibbonPath(
            pair.nodeB,
            pair.nodeA,

            calculateEdgeStartWidth(
              pair.bToA
            )
          )
        );
      }
    }


    animationFrameId =
      requestAnimationFrame(
        animate
      );
  }


  animationFrameId =
    requestAnimationFrame(
      animate
    );
}


// ==================================================
// Selection
// ==================================================

function clearSelection() {

  document
    .querySelectorAll(
      ".dimmed"
    )
    .forEach(
      element =>
        element
          .classList
          .remove(
            "dimmed"
          )
    );


  document
    .querySelectorAll(
      ".edge-highlight"
    )
    .forEach(
      element =>
        element
          .classList
          .remove(
            "edge-highlight"
          )
    );


  document
    .querySelectorAll(
      ".ranking-item.is-selected"
    )
    .forEach(
      element =>
        element
          .classList
          .remove(
            "is-selected"
          )
    );
}


function highlightNode(
  selectedDomain,
  graph
) {

  const connected =
    new Set([
      selectedDomain
    ]);


  for (
    const edge
    of graph.edges
  ) {

    if (
      edge.source ===
      selectedDomain
    ) {

      connected.add(
        edge.target
      );
    }


    if (
      edge.target ===
      selectedDomain
    ) {

      connected.add(
        edge.source
      );
    }
  }


  document
    .querySelectorAll(
      ".node-group"
    )
    .forEach(
      group => {

        group.classList.toggle(
          "dimmed",

          !connected.has(
            group.dataset.domain
          )
        );
      }
    );


  document
    .querySelectorAll(
      ".edge-pair"
    )
    .forEach(
      group => {

        const connectedEdge =
          group.dataset.a ===
            selectedDomain
          ||
          group.dataset.b ===
            selectedDomain;


        group.classList.toggle(
          "edge-highlight",
          connectedEdge
        );


        group.classList.toggle(
          "dimmed",
          !connectedEdge
        );
      }
    );


  document
    .querySelectorAll(
      ".ranking-item"
    )
    .forEach(
      item => {

        item.classList.toggle(
          "is-selected",

          item.dataset.domain ===
          selectedDomain
        );
      }
    );
}


// ==================================================
// Detail panel
// ==================================================

function showNodeDetail(
  node,
  graph
) {

  const incoming =
    graph.edges

      .filter(
        edge =>
          edge.target ===
          node.domain
      )

      .sort(
        (
          a,
          b
        ) =>
          b.count -
          a.count
      );


  const outgoing =
    graph.edges

      .filter(
        edge =>
          edge.source ===
          node.domain
      )

      .sort(
        (
          a,
          b
        ) =>
          b.count -
          a.count
      );


  detailElement.innerHTML =
    "";


  const eyebrow =
    document.createElement(
      "div"
    );


  eyebrow.className =
    "panel-eyebrow";


  eyebrow.textContent =
    "선택한 사이트";


  const title =
    document.createElement(
      "h2"
    );


  title.textContent =
    node.domain;


  const stats =
    document.createElement(
      "div"
    );


  stats.className =
    "detail-stats";


  const statValues = [

    [
      "활성시간",
      formatDuration(
        node.activeTime
      )
    ],

    [
      "세션",
      `${node.sessionCount}회`
    ],

    [
      "연결",
      `${incoming.length + outgoing.length}개`
    ],

    [
      "중요도",
      `${Math.round(
        node.importance *
        100
      )}%`
    ]

  ];


  for (
    const [
      label,
      value
    ]
    of statValues
  ) {

    const box =
      document.createElement(
        "div"
      );


    box.className =
      "detail-stat";


    const labelElement =
      document.createElement(
        "span"
      );


    labelElement.textContent =
      label;


    const valueElement =
      document.createElement(
        "strong"
      );


    valueElement.textContent =
      value;


    box.append(
      labelElement,
      valueElement
    );


    stats.appendChild(
      box
    );
  }


  detailElement.append(
    eyebrow,
    title,
    stats
  );


  if (
    incoming.length >
    0
  ) {

    const heading =
      document.createElement(
        "h3"
      );


    heading.textContent =
      "주요 유입";


    const list =
      document.createElement(
        "ul"
      );


    for (
      const edge
      of incoming.slice(
        0,
        5
      )
    ) {

      const item =
        document.createElement(
          "li"
        );


      item.textContent =
        `${edge.source} → ${node.domain} (${edge.count}회)`;


      list.appendChild(
        item
      );
    }


    detailElement.append(
      heading,
      list
    );
  }


  if (
    outgoing.length >
    0
  ) {

    const heading =
      document.createElement(
        "h3"
      );


    heading.textContent =
      "주요 이동";


    const list =
      document.createElement(
        "ul"
      );


    for (
      const edge
      of outgoing.slice(
        0,
        5
      )
    ) {

      const item =
        document.createElement(
          "li"
        );


      item.textContent =
        `${node.domain} → ${edge.target} (${edge.count}회)`;


      list.appendChild(
        item
      );
    }


    detailElement.append(
      heading,
      list
    );
  }
}


// ==================================================
// Ranking
// ==================================================

function renderRanking(
  nodes,
  graph
) {

  rankingListElement.innerHTML =
    "";


  if (
    nodes.length ===
    0
  ) {

    rankingListElement.textContent =
      "아직 이용 기록이 없습니다.";

    return;
  }


  /*
   * "이용률"은 실제 활성시간 기준.
   *
   * 노드의 importance와는 별개다.
   */
  const totalActiveTime =
    nodes.reduce(
      (
        sum,
        node
      ) =>
        sum +
        node.activeTime,

      0
    );


  const rankedNodes =
    [...nodes]
      .sort(
        (
          a,
          b
        ) =>
          b.activeTime -
          a.activeTime
      );


  const visibleNodes =
    rankedNodes.slice(
      0,
      10
    );


  const maxActiveTime =
    Math.max(
      1,

      visibleNodes[0]
        ?.activeTime ??
        1
    );


  visibleNodes.forEach(
    (
      node,
      index
    ) => {

      const usageRate =
        totalActiveTime >
        0

          ? (
              node.activeTime /
              totalActiveTime
            ) *
            100

          : 0;


      /*
       * 막대는 1위 사이트를 100% 폭으로 두고
       * 나머지를 상대적으로 표현.
       */
      const relativeBar =
        (
          node.activeTime /
          maxActiveTime
        ) *
        100;


      const item =
        document.createElement(
          "button"
        );


      item.type =
        "button";


      item.className =
        "ranking-item";


      item.dataset.domain =
        node.domain;


      item.title =
        `${node.domain} 상세 보기`;


      const position =
        document.createElement(
          "span"
        );


      position.className =
        "ranking-position";


      position.textContent =
        String(
          index +
          1
        );


      const content =
        document.createElement(
          "span"
        );


      content.className =
        "ranking-content";


      const topRow =
        document.createElement(
          "span"
        );


      topRow.className =
        "ranking-domain-row";


      const domain =
        document.createElement(
          "span"
        );


      domain.className =
        "ranking-domain";


      domain.textContent =
        node.domain;


      const score =
        document.createElement(
          "span"
        );


      score.className =
        "ranking-score";


      score.textContent =
        `${usageRate.toFixed(1)}%`;


      const bar =
        document.createElement(
          "span"
        );


      bar.className =
        "ranking-bar";


      const fill =
        document.createElement(
          "span"
        );


      fill.className =
        "ranking-bar-fill";


      fill.style.width =
        `${Math.max(
          2,
          relativeBar
        )}%`;


      const meta =
        document.createElement(
          "span"
        );


      meta.className =
        "ranking-meta";


      meta.textContent =
        `${formatDuration(
          node.activeTime
        )} · ${node.sessionCount}회 방문`;


      topRow.append(
        domain,
        score
      );


      bar.appendChild(
        fill
      );


      content.append(
        topRow,
        bar,
        meta
      );


      item.append(
        position,
        content
      );


      /*
       * Ranking에서도 사이트 선택 가능.
       */
      item.addEventListener(
        "click",
        () => {

          highlightNode(
            node.domain,
            graph
          );


          showNodeDetail(
            node,
            graph
          );
        }
      );


      rankingListElement.appendChild(
        item
      );
    }
  );
}


// ==================================================
// SVG Definitions
// ==================================================

function createDefinitions() {

  const defs =
    createSvgElement(
      "defs"
    );


  defs.innerHTML = `

    <radialGradient
      id="dropletGradient"
      cx="30%"
      cy="22%"
      r="86%"
    >

      <stop
        offset="0%"
        stop-color="#3b4568"
        stop-opacity="0.60"
      />

      <stop
        offset="22%"
        stop-color="#1c2441"
        stop-opacity="0.72"
      />

      <stop
        offset="52%"
        stop-color="#0a1025"
        stop-opacity="0.84"
      />

      <stop
        offset="80%"
        stop-color="#040716"
        stop-opacity="0.94"
      />

      <stop
        offset="100%"
        stop-color="#010208"
        stop-opacity="0.99"
      />

    </radialGradient>


    <radialGradient
      id="innerGlassGradient"
      cx="32%"
      cy="26%"
      r="74%"
    >

      <stop
        offset="0%"
        stop-color="#ffffff"
        stop-opacity="0.17"
      />

      <stop
        offset="35%"
        stop-color="#9aacff"
        stop-opacity="0.065"
      />

      <stop
        offset="72%"
        stop-color="#765cff"
        stop-opacity="0.03"
      />

      <stop
        offset="100%"
        stop-color="#000000"
        stop-opacity="0"
      />

    </radialGradient>


    <filter
      id="dropletShadow"
      x="-80%"
      y="-80%"
      width="260%"
      height="260%"
    >

      <feDropShadow
        dx="0"
        dy="7"
        stdDeviation="8"
        flood-color="#000000"
        flood-opacity="0.78"
      />

    </filter>


    <filter
      id="hoverGlow"
      x="-160%"
      y="-160%"
      width="420%"
      height="420%"
    >

      <feGaussianBlur
        stdDeviation="6"
        result="blurred"
      />

      <feMerge>

        <feMergeNode
          in="blurred"
        />

        <feMergeNode
          in="SourceGraphic"
        />

      </feMerge>

    </filter>


    <filter
      id="highlightBlur"
      x="-100%"
      y="-100%"
      width="300%"
      height="300%"
    >

      <feGaussianBlur
        stdDeviation="1.2"
      />

    </filter>

  `;


  svg.appendChild(
    defs
  );


  return defs;
}


// ==================================================
// Render
// ==================================================

function renderGraph(
  graph
) {

  if (
    animationFrameId
  ) {

    cancelAnimationFrame(
      animationFrameId
    );


    animationFrameId =
      null;
  }


  hoveredNode =
    null;


  svg.innerHTML =
    "";


  const {
    nodes,
    edges
  } =
    graph;


  if (
    nodes.length ===
    0
  ) {

    summaryElement.textContent =
      "아직 기록된 데이터가 없습니다.";


    rankingListElement.textContent =
      "아직 이용 기록이 없습니다.";


    return;
  }


  const defs =
    createDefinitions();


  /*
   * 중요도 계산도 여기서 이뤄진다.
   */
  createForceLayout(
    nodes,
    edges
  );


  projectNodes(
    nodes
  );


  renderRanking(
    nodes,
    graph
  );


  const nodeMap =
    new Map(
      nodes.map(
        node => [
          node.domain,
          node
        ]
      )
    );


  // ==================================================
  // Edge Layer
  // ==================================================

  const edgeLayer =
    createSvgElement(
      "g"
    );


  edgeLayer.setAttribute(
    "class",
    "edge-layer"
  );


  const edgePairs =
    createEdgePairs(
      edges
    );


  for (
    const pair
    of edgePairs
  ) {

    pair.nodeA =
      nodeMap.get(
        pair.a
      );


    pair.nodeB =
      nodeMap.get(
        pair.b
      );
  }


  edgePairs.sort(
    (
      a,
      b
    ) => {

      const az =
        (
          (
            a.nodeA?.z ??
            0
          )
          +
          (
            a.nodeB?.z ??
            0
          )
        ) /
        2;


      const bz =
        (
          (
            b.nodeA?.z ??
            0
          )
          +
          (
            b.nodeB?.z ??
            0
          )
        ) /
        2;


      return (
        az -
        bz
      );
    }
  );


  for (
    const pair
    of edgePairs
  ) {

    const a =
      pair.nodeA;


    const b =
      pair.nodeB;


    if (
      !a ||
      !b
    ) {

      continue;
    }


    const group =
      createSvgElement(
        "g"
      );


    group.setAttribute(
      "class",
      "edge-pair"
    );


    group.dataset.a =
      pair.a;


    group.dataset.b =
      pair.b;


    if (
      pair.aToB >
      0
    ) {

      const ribbon =
        createSvgElement(
          "path"
        );


      ribbon.setAttribute(
        "class",
        "edge-ribbon"
      );


      ribbon.setAttribute(
        "d",

        createTaperedRibbonPath(
          a,
          b,

          calculateEdgeStartWidth(
            pair.aToB
          )
        )
      );


      pair.aToBElement =
        ribbon;


      group.appendChild(
        ribbon
      );
    }


    if (
      pair.bToA >
      0
    ) {

      const ribbon =
        createSvgElement(
          "path"
        );


      ribbon.setAttribute(
        "class",
        "edge-ribbon"
      );


      ribbon.setAttribute(
        "d",

        createTaperedRibbonPath(
          b,
          a,

          calculateEdgeStartWidth(
            pair.bToA
          )
        )
      );


      pair.bToAElement =
        ribbon;


      group.appendChild(
        ribbon
      );
    }


    edgeLayer.appendChild(
      group
    );
  }


  svg.appendChild(
    edgeLayer
  );


  // ==================================================
  // Node Layers
  // ==================================================

  const nodeLayer =
    createSvgElement(
      "g"
    );


  nodeLayer.setAttribute(
    "class",
    "node-layer"
  );


  const hoverLayer =
    createSvgElement(
      "g"
    );


  hoverLayer.setAttribute(
    "class",
    "hover-layer"
  );


  const sortedNodes =
    [...nodes]
      .sort(
        (
          a,
          b
        ) =>
          a.z -
          b.z
      );


  sortedNodes.forEach(
    (
      node,
      index
    ) => {

      const group =
        createSvgElement(
          "g"
        );


      group.setAttribute(
        "class",
        "node-group"
      );


      group.dataset.domain =
        node.domain;


      group.setAttribute(
        "opacity",
        String(
          node.depthOpacity
        )
      );


      node.domGroup =
        group;


      // ----------------------------------------------
      // Hover glow
      // ----------------------------------------------

      const hoverGlow =
        createSvgElement(
          "circle"
        );


      hoverGlow.setAttribute(
        "cx",
        node.screenX
      );


      hoverGlow.setAttribute(
        "cy",
        node.screenY
      );


      hoverGlow.setAttribute(
        "r",
        node.screenRadius *
        1.06
      );


      hoverGlow.setAttribute(
        "class",
        "node-hover-glow"
      );


      hoverGlow.setAttribute(
        "filter",
        "url(#hoverGlow)"
      );


      group.appendChild(
        hoverGlow
      );


      // ----------------------------------------------
      // Glass body
      // ----------------------------------------------

      const body =
        createSvgElement(
          "circle"
        );


      body.setAttribute(
        "cx",
        node.screenX
      );


      body.setAttribute(
        "cy",
        node.screenY
      );


      body.setAttribute(
        "r",
        node.screenRadius
      );


      body.setAttribute(
        "class",
        "droplet-node"
      );


      body.setAttribute(
        "fill",
        "url(#dropletGradient)"
      );


      body.setAttribute(
        "filter",
        "url(#dropletShadow)"
      );


      group.appendChild(
        body
      );


      // ----------------------------------------------
      // Brand Color
      // ----------------------------------------------

      const brandGradient =
        createBrandGradient(
          defs,
          index
        );


      const brandCircle =
        createSvgElement(
          "circle"
        );


      brandCircle.setAttribute(
        "cx",
        node.screenX
      );


      brandCircle.setAttribute(
        "cy",
        node.screenY
      );


      brandCircle.setAttribute(
        "r",
        node.screenRadius *
        0.48
      );


      brandCircle.setAttribute(
        "fill",
        `url(#${brandGradient.id})`
      );


      brandCircle.setAttribute(
        "class",
        "node-brand-fill"
      );


      group.appendChild(
        brandCircle
      );


      // ----------------------------------------------
      // Inner glass
      // ----------------------------------------------

      const innerGlass =
        createSvgElement(
          "circle"
        );


      innerGlass.setAttribute(
        "cx",
        node.screenX
      );


      innerGlass.setAttribute(
        "cy",
        node.screenY
      );


      innerGlass.setAttribute(
        "r",
        node.screenRadius *
        0.92
      );


      innerGlass.setAttribute(
        "fill",
        "url(#innerGlassGradient)"
      );


      innerGlass.setAttribute(
        "class",
        "droplet-inner"
      );


      group.appendChild(
        innerGlass
      );


      // ----------------------------------------------
      // Fallback Letter
      // ----------------------------------------------

      const fallback =
        createSvgElement(
          "text"
        );


      fallback.setAttribute(
        "x",
        node.screenX
      );


      fallback.setAttribute(
        "y",
        node.screenY
      );


      fallback.setAttribute(
        "class",
        "node-fallback"
      );


      fallback.setAttribute(
        "font-size",

        Math.max(
          16,

          node.screenRadius *
          0.62
        )
      );


      fallback.textContent =
        node.domain
          .charAt(0)
          .toUpperCase();


      group.appendChild(
        fallback
      );


      // ----------------------------------------------
      // Favicon
      // ----------------------------------------------

      const iconSize =
        node.screenRadius *
        0.94;


      const favicon =
        createSvgElement(
          "image"
        );


      favicon.setAttribute(
        "x",

        node.screenX -
        iconSize /
        2
      );


      favicon.setAttribute(
        "y",

        node.screenY -
        iconSize /
        2
      );


      favicon.setAttribute(
        "width",
        iconSize
      );


      favicon.setAttribute(
        "height",
        iconSize
      );


      favicon.setAttribute(
        "preserveAspectRatio",
        "xMidYMid meet"
      );


      favicon.setAttribute(
        "class",
        "node-favicon"
      );


      group.appendChild(
        favicon
      );


      bindNodeFavicon(
        node,
        favicon,
        fallback,

        loadedUrl => {

          applyBrandColor(
            node,
            brandGradient,
            loadedUrl
          );
        }
      );


      // ----------------------------------------------
      // Glass Highlight
      // ----------------------------------------------

      const highlight =
        createSvgElement(
          "ellipse"
        );


      highlight.setAttribute(
        "cx",

        node.screenX -
        node.screenRadius *
        0.24
      );


      highlight.setAttribute(
        "cy",

        node.screenY -
        node.screenRadius *
        0.31
      );


      highlight.setAttribute(
        "rx",

        node.screenRadius *
        0.35
      );


      highlight.setAttribute(
        "ry",

        node.screenRadius *
        0.12
      );


      highlight.setAttribute(
        "class",
        "droplet-highlight"
      );


      highlight.setAttribute(
        "filter",
        "url(#highlightBlur)"
      );


      group.appendChild(
        highlight
      );


      const glint =
        createSvgElement(
          "circle"
        );


      glint.setAttribute(
        "cx",

        node.screenX -
        node.screenRadius *
        0.42
      );


      glint.setAttribute(
        "cy",

        node.screenY -
        node.screenRadius *
        0.38
      );


      glint.setAttribute(
        "r",

        Math.max(
          1.6,

          node.screenRadius *
          0.055
        )
      );


      glint.setAttribute(
        "class",
        "droplet-glint"
      );


      group.appendChild(
        glint
      );


      // ----------------------------------------------
      // Domain Label
      // ----------------------------------------------

      const label =
        createSvgElement(
          "text"
        );


      label.setAttribute(
        "x",
        node.screenX
      );


      label.setAttribute(
        "y",

        node.screenY
        +
        node.screenRadius
        +
        Math.max(
          18,

          node.labelFontSize *
          1.15
        )
      );


      label.setAttribute(
        "font-size",
        node.labelFontSize
      );


      label.setAttribute(
        "class",
        "node-label"
      );


      label.textContent =
        node.domain;


      group.appendChild(
        label
      );


      nodeLayer.appendChild(
        group
      );
    }
  );


  svg.appendChild(
    nodeLayer
  );


  svg.appendChild(
    hoverLayer
  );


  // ==================================================
  // Pointer interaction
  // ==================================================

  svg.addEventListener(
    "pointermove",

    event => {

      const point =
        getSvgPointerPosition(
          event
        );


      if (!point) {

        return;
      }


      const node =
        findNodeAtPoint(
          nodes,
          point.x,
          point.y
        );


      setHoveredNode(
        node,
        nodes,
        nodeLayer,
        hoverLayer
      );


      svg.style.cursor =
        node

          ? "pointer"

          : "default";
    }
  );


  svg.addEventListener(
    "pointerleave",

    () => {

      setHoveredNode(
        null,
        nodes,
        nodeLayer,
        hoverLayer
      );


      svg.style.cursor =
        "default";


      pointerDownNode =
        null;


      pointerDownPoint =
        null;
    }
  );


  svg.addEventListener(
    "pointerdown",

    event => {

      const point =
        getSvgPointerPosition(
          event
        );


      if (!point) {

        return;
      }


      pointerDownNode =
        findNodeAtPoint(
          nodes,
          point.x,
          point.y
        );


      pointerDownPoint = {

        x:
          point.x,

        y:
          point.y
      };
    }
  );


  svg.addEventListener(
    "pointerup",

    event => {

      const point =
        getSvgPointerPosition(
          event
        );


      if (
        !point ||
        !pointerDownPoint
      ) {

        pointerDownNode =
          null;


        pointerDownPoint =
          null;


        return;
      }


      const upNode =
        findNodeAtPoint(
          nodes,
          point.x,
          point.y
        );


      const dx =
        point.x -
        pointerDownPoint.x;


      const dy =
        point.y -
        pointerDownPoint.y;


      const movement =
        Math.sqrt(
          dx * dx +
          dy * dy
        );


      if (
        pointerDownNode &&
        upNode ===
        pointerDownNode &&
        movement <
        8
      ) {

        highlightNode(
          upNode.domain,
          graph
        );


        showNodeDetail(
          upNode,
          graph
        );

      } else if (
        !pointerDownNode &&
        !upNode &&
        movement <
        8
      ) {

        clearSelection();
      }


      pointerDownNode =
        null;


      pointerDownPoint =
        null;
    }
  );


  // ==================================================
  // Summary
  // ==================================================

  const totalTime =
    nodes.reduce(
      (
        sum,
        node
      ) =>
        sum +
        node.activeTime,

      0
    );


  const transitionCount =
    edges.reduce(
      (
        sum,
        edge
      ) =>
        sum +
        edge.count,

      0
    );


  summaryElement.textContent =
    `${nodes.length}개 사이트 · ${transitionCount}번 이동 · ${formatDuration(totalTime)}`;


  startAnimation(
    nodes,
    edgePairs,
    nodeLayer,
    hoverLayer
  );
}


// ==================================================
// Initialize
// ==================================================

async function initialize() {

  try {

    const sessions =
      await loadSessions();


    const graph =
      aggregateSessions(
        sessions
      );


    renderGraph(
      graph
    );

  } catch (
    error
  ) {

    console.error(
      "[Internet Map]",
      error
    );


    summaryElement.textContent =
      "데이터를 불러오지 못했습니다.";


    rankingListElement.textContent =
      "데이터를 불러오지 못했습니다.";
  }
}


initialize();