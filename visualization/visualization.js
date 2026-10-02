const svg =
  document.querySelector("#network");

const summaryElement =
  document.querySelector("#summary");

const detailElement =
  document.querySelector("#detail");

const rankingListElement =
  document.querySelector("#rankingList");

const periodFilterElement =
  document.querySelector("#periodFilter");


const SVG_NS =
  "http://www.w3.org/2000/svg";


const WIDTH = 1200;
const HEIGHT = 700;

const NODE_BUBBLE_TEXTURE_URLS = [
  "bubble-clean.png"
].map(filename => chrome.runtime.getURL(`visualization/assets/${filename}`));
const nodeBubbleTextures = new Map();

function getNodeBubbleTexture(domain) {
  if (!nodeBubbleTextures.has(domain)) {
    const index = Math.floor(Math.random() * NODE_BUBBLE_TEXTURE_URLS.length);
    nodeBubbleTextures.set(domain, NODE_BUBBLE_TEXTURE_URLS[index]);
  }
  return nodeBubbleTextures.get(domain);
}

const NODE_FAVICON_SIZE_MULTIPLIER = 1.3;
// The supplied PNG has roughly 8% transparent padding on each side.
const NODE_BUBBLE_SIZE_MULTIPLIER = 2.35;

const NODE_GLOW_TEXTURE_URL =
  chrome.runtime.getURL(
    "visualization/assets/node-glow.png"
  );


/*
 * 생성한 glow 이미지에서
 * 실제 물방울 테두리와 가장 밝은 부분이 일치하는 크기.
 *
 * 이미지 반지름 = 노드 반지름 × 1.6
 * 이미지 내부 62.5% 지점 = 실제 노드 반지름
 */
const NODE_GLOW_SIZE_MULTIPLIER =
  3.2;


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
  3;

const EDGE_WIDTH_PER_TRANSITION =
  4;

const EDGE_MAX_START_WIDTH =
  64;


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


let activePeriodKey =
  "today";


let selectedDomain =
  null;


let layoutPositionMemory =
  new Map();


const PERIODS = {

  today: {
    label:
      "오늘",

    days:
      1
  },


  "7days": {
    label:
      "최근 7일",

    days:
      7
  },


  "30days": {
    label:
      "최근 30일",

    days:
      30
  },


  all: {
    label:
      "전체",

    days:
      null
  }
};


// ==================================================
// Data
// ==================================================

// ==================================================
// Period filtering
// ==================================================

function getPeriodRange(
  periodKey,
  now = new Date()
) {

  const period =
    PERIODS[periodKey] ??
    PERIODS.today;


  if (
    period.days ===
    null
  ) {

    return {
      key:
        "all",

      label:
        period.label,

      start:
        null,

      end:
        null
    };
  }


  const end =
    now.getTime();


  const startDate =
    new Date(
      end
    );


  /*
   * setHours / setDate를 사용해서 사용자 로컬 시간의
   * 자정과 일광절약시간 경계를 그대로 따른다.
   */
  startDate.setHours(
    0,
    0,
    0,
    0
  );


  startDate.setDate(
    startDate.getDate()
    -
    (
      period.days -
      1
    )
  );


  return {
    key:
      periodKey,

    label:
      period.label,

    start:
      startDate.getTime(),

    end
  };
}


function toTimestamp(
  value
) {

  if (
    typeof value ===
    "number"
  ) {

    return Number.isFinite(
      value
    )

      ? value

      : null;
  }


  const timestamp =
    Date.parse(
      value
    );


  return Number.isFinite(
    timestamp
  )

    ? timestamp

    : null;
}


function clipSessionsToRange(
  sessions,
  range
) {

  /*
   * "전체"는 날짜 필터를 적용하지 않는다.
   * 저장된 duration을 그대로 사용하고, 누락된 경우에만
   * startedAt / endedAt 차이로 복구한다.
   */
  if (
    range.start ===
    null
  ) {

    return sessions.map(
      session => {

        const startedAt =
          toTimestamp(
            session.startedAt
          );


        const endedAt =
          toTimestamp(
            session.endedAt
          );


        const derivedDuration =
          startedAt !==
            null &&
          endedAt !==
            null

            ? Math.max(
                0,
                endedAt -
                startedAt
              )

            : 0;


        return {
          ...session,

          duration:
            Number.isFinite(
              session.duration
            )

              ? Math.max(
                  0,
                  session.duration
                )

              : derivedDuration
        };
      }
    );
  }

  const clippedSessions =
    [];


  for (
    const session
    of sessions
  ) {

    const startedAt =
      toTimestamp(
        session.startedAt
      );


    const endedAt =
      toTimestamp(
        session.endedAt
      );


    /*
     * 기간 필터는 원본의 startedAt / endedAt을 기준으로 한다.
     * 날짜가 없는 예전 데이터는 기간을 판별할 수 없으므로 제외한다.
     */
    if (
      startedAt ===
        null ||
      endedAt ===
        null
    ) {

      continue;
    }


    const sessionStart =
      Math.min(
        startedAt,
        endedAt
      );


    const sessionEnd =
      Math.max(
        startedAt,
        endedAt
      );


    const overlapStart =
      Math.max(
        sessionStart,
        range.start
      );


    const overlapEnd =
      Math.min(
        sessionEnd,
        range.end
      );


    /*
     * 경계와 실제로 겹친 세션만 포함한다.
     * 포함된 세션은 방문 / 이동 횟수에는 1회로 집계되고,
     * 활성시간만 겹친 길이로 잘린다.
     */
    if (
      overlapEnd <=
      overlapStart
    ) {

      continue;
    }


    clippedSessions.push({
      ...session,

      startedAt:
        overlapStart,

      endedAt:
        overlapEnd,

      duration:
        overlapEnd -
        overlapStart
    });
  }


  return clippedSessions;
}


// ==================================================
// Sessions → Graph
// ==================================================

// Keep raw storage/export intact so grouping rules remain reversible.
function groupSessionBySite(session) {
  const domain = getSiteDomain(session.domain);
  const fromDomain = getSiteDomain(session.fromDomain);
  return {...session, domain, fromDomain: fromDomain === domain ? null : fromDomain};
}

function aggregateSessions(
  sessions
) {

  const nodeMap =
    new Map();


  const edgeMap =
    new Map();


  for (
    const rawSession
    of sessions
  ) {

    const session = groupSessionBySite(rawSession);

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


function calculateNodeMobility(
  node
) {

  const component =
    node.layoutComponentRef;


  const incidentWeight =
    node.layoutIncidentWeight ??
    0;


  const componentWeight =
    component?.edgeWeight ??
    incidentWeight;


  if (
    componentWeight <=
    0
  ) {

    return 0.72;
  }


  const topologyCentrality =
    Math.min(
      1,

      incidentWeight /
      Math.max(
        componentWeight,
        1
      )
    );


  return (
    1 /
    (
      1 +
      topologyCentrality *
      2.35
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


function getSuperellipseBoundaryScale(
  directionX,
  directionY
) {

  const volume =
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
    );


  if (
    volume <=
    0
  ) {

    return 0;
  }


  return Math.pow(
    volume,

    -1 /
    LAYOUT_SHAPE_POWER
  );
}


function getSuperellipsePoint(
  angle,
  radiusRatio,
  inset
) {

  const centerX =
    WIDTH /
    2;


  const centerY =
    HEIGHT /
    2;


  const directionX =
    Math.cos(
      angle
    );


  const directionY =
    Math.sin(
      angle
    );


  const boundaryScale =
    getSuperellipseBoundaryScale(
      directionX,
      directionY
    );


  const usableHalfWidth =
    Math.max(
      40,

      LAYOUT_HALF_WIDTH -
      inset
    );


  const usableHalfHeight =
    Math.max(
      40,

      LAYOUT_HALF_HEIGHT -
      inset
    );


  return {

    x:
      centerX
      +
      directionX *
      boundaryScale *
      usableHalfWidth *
      radiusRatio,

    y:
      centerY
      +
      directionY *
      boundaryScale *
      usableHalfHeight *
      radiusRatio
  };
}


function buildLayoutComponents(
  nodes,
  layoutEdges,
  nodeMap
) {

  const adjacency =
    new Map(
      nodes.map(
        node => [
          node.domain,
          []
        ]
      )
    );


  for (
    const node
    of nodes
  ) {

    node.layoutIncidentWeight =
      0;
  }


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


    adjacency
      .get(
        edge.source
      )
      .push({
        domain:
          edge.target,

        count:
          edge.count
      });


    adjacency
      .get(
        edge.target
      )
      .push({
        domain:
          edge.source,

        count:
          edge.count
      });


    source.layoutIncidentWeight +=
      edge.count;


    target.layoutIncidentWeight +=
      edge.count;
  }


  const visited =
    new Set();


  const components =
    [];


  for (
    const node
    of nodes
  ) {

    if (
      visited.has(
        node.domain
      )
    ) {

      continue;
    }


    const stack =
      [
        node.domain
      ];


    const componentNodes =
      [];


    visited.add(
      node.domain
    );


    while (
      stack.length >
      0
    ) {

      const domain =
        stack.pop();


      const currentNode =
        nodeMap.get(
          domain
        );


      if (
        !currentNode
      ) {

        continue;
      }


      componentNodes.push(
        currentNode
      );


      for (
        const neighbor
        of adjacency.get(
          domain
        ) ?? []
      ) {

        if (
          visited.has(
            neighbor.domain
          )
        ) {

          continue;
        }


        visited.add(
          neighbor.domain
        );


        stack.push(
          neighbor.domain
        );
      }
    }


    const nodeDomains =
      new Set(
        componentNodes.map(
          componentNode =>
            componentNode.domain
        )
      );


    const componentEdges =
      layoutEdges.filter(
        edge =>
          nodeDomains.has(
            edge.source
          )
          &&
          nodeDomains.has(
            edge.target
          )
      );


    const edgeWeight =
      componentEdges.reduce(
        (
          sum,
          edge
        ) =>
          sum +
          edge.count,

        0
      );


    const radius =
      Math.max(
        44,

        Math.sqrt(
          componentNodes.reduce(
            (
              sum,
              componentNode
            ) =>
              sum
              +
              Math.pow(
                componentNode.radius +
                34,
                2
              ),

            0
          )
        ) *
        (
          componentNodes.length ===
          1

            ? 0.9

            : 1.12
        )
      );


    const id =
      componentNodes
        .map(
          componentNode =>
            componentNode.domain
        )
        .sort()
        .join(
          "|"
        );


    const component = {

      id,

      nodes:
        componentNodes,

      edges:
        componentEdges,

      edgeWeight,

      radius,

      centerX:
        WIDTH /
        2,

      centerY:
        HEIGHT /
        2,

      isIsolated:
        edgeWeight ===
        0
    };


    for (
      const componentNode
      of componentNodes
    ) {

      componentNode.layoutComponent =
        component.id;


      componentNode.layoutComponentRef =
        component;
    }


    components.push(
      component
    );
  }


  return components;
}


function rankLayoutComponents(
  components
) {

  return [...components].sort(
    (
      a,
      b
    ) => {

      if (
        a.isIsolated !==
        b.isIsolated
      ) {

        return a.isIsolated

          ? 1

          : -1;
      }


      if (
        b.edgeWeight !==
        a.edgeWeight
      ) {

        return b.edgeWeight -
          a.edgeWeight;
      }


      if (
        b.nodes.length !==
        a.nodes.length
      ) {

        return b.nodes.length -
          a.nodes.length;
      }


      const aImportance =
        a.nodes.reduce(
          (
            sum,
            node
          ) =>
            sum +
            node.importance,

          0
        );


      const bImportance =
        b.nodes.reduce(
          (
            sum,
            node
          ) =>
            sum +
            node.importance,

          0
        );


      if (
        bImportance !==
        aImportance
      ) {

        return bImportance -
          aImportance;
      }


      return domainHash(
        a.id
      )
      -
      domainHash(
        b.id
      );
    }
  );
}


function calculateComponentOverlapPenalty(
  candidate,
  placedComponents,
  component
) {

  let penalty =
    0;


  for (
    const placed
    of placedComponents
  ) {

    const dx =
      candidate.x -
      placed.centerX;


    const dy =
      candidate.y -
      placed.centerY;


    const distance =
      Math.max(
        Math.sqrt(
          dx * dx +
          dy * dy
        ),

        1
      );


    const minimumDistance =
      component.radius
      +
      placed.radius
      +
      46;


    if (
      distance <
      minimumDistance
    ) {

      penalty +=
        Math.pow(
          minimumDistance -
          distance,
          2
        ) *
        12;
    }


    penalty +=
      1200 /
      distance;
  }


  return penalty;
}


function createComponentCenterCandidates(
  component,
  orderedIndex,
  totalCount
) {

  const candidates =
    [];


  if (
    orderedIndex ===
    0
    &&
    (
      !component.isIsolated
      ||
      totalCount ===
      1
    )
  ) {

    candidates.push({

      x:
        WIDTH /
        2,

      y:
        HEIGHT /
        2,

      ratio:
        0
    });
  }


  const baseAngle =
    domainHash(
      `${component.id}:component-angle`
    ) *
    Math.PI *
    2;


  const rings =
    component.isIsolated

      ? [
          0.72,
          0.84,
          0.94,
          0.62
        ]

      : [
          0.22,
          0.38,
          0.54,
          0.70,
          0.84
        ];


  for (
    let ringIndex = 0;
    ringIndex < rings.length;
    ringIndex++
  ) {

    const ratio =
      rings[ringIndex];


    const slots =
      Math.max(
        8,

        Math.ceil(
          totalCount *
          (
            ringIndex +
            1
          ) *
          1.45
        )
      );


    for (
      let slot = 0;
      slot < slots;
      slot++
    ) {

      const angle =
        baseAngle
        +
        (
          slot /
          slots
        ) *
        Math.PI *
        2
        +
        ringIndex *
        0.37;


      candidates.push({
        ...getSuperellipsePoint(
          angle,
          ratio,
          component.radius +
            28
        ),

        ratio
      });
    }
  }


  return candidates;
}


function packLayoutComponents(
  components
) {

  const orderedComponents =
    rankLayoutComponents(
      components
    );


  const placedComponents =
    [];


  for (
    let orderedIndex = 0;
    orderedIndex < orderedComponents.length;
    orderedIndex++
  ) {

    const component =
      orderedComponents[orderedIndex];


    const candidates =
      createComponentCenterCandidates(
        component,
        orderedIndex,
        orderedComponents.length
      );


    let bestCandidate =
      candidates[0] ?? {
        x:
          WIDTH /
          2,

        y:
          HEIGHT /
          2,

        ratio:
          0
      };


    let bestScore =
      Infinity;


    const desiredRatio =
      orderedComponents.length ===
      1

        ? 0

        : component.isIsolated

          ? 0.84

          : Math.min(
              0.62,

              0.18 +
              orderedIndex *
              0.08
            );


    for (
      const candidate
      of candidates
    ) {

      const overlapPenalty =
        calculateComponentOverlapPenalty(
          candidate,
          placedComponents,
          component
        );


      const centerBias =
        Math.pow(
          candidate.ratio -
          desiredRatio,
          2
        ) *
        (
          component.isIsolated

            ? 900

            : 420
        );


      const score =
        overlapPenalty +
        centerBias;


      if (
        score <
        bestScore
      ) {

        bestScore =
          score;


        bestCandidate =
          candidate;
      }
    }


    component.centerX =
      bestCandidate.x;


    component.centerY =
      bestCandidate.y;


    placedComponents.push(
      component
    );
  }
}


function initializeNodeLayoutPosition(
  node,
  component
) {

  const rememberedPosition =
    layoutPositionMemory.get(
      node.domain
    );


  const angle =
    domainHash(
      `${node.domain}:layout-angle`
    ) *
    Math.PI *
    2;


  const topologyRatio =
    component.nodes.length ===
    1

      ? 0

      : 0.18
        +
        (
          1 -
          Math.min(
            1,
            node.layoutIncidentWeight /
              Math.max(
                component.edgeWeight,
                1
              )
          )
        ) *
        0.52;


  const localRadius =
    component.radius *
    topologyRatio *
    (
      0.62
      +
      domainHash(
        `${node.domain}:layout-radius`
      ) *
      0.38
    );


  const seededX =
    component.centerX
    +
    Math.cos(
      angle
    ) *
    localRadius;


  const seededY =
    component.centerY
    +
    Math.sin(
      angle
    ) *
    localRadius;


  if (
    rememberedPosition
  ) {

    node.x =
      rememberedPosition.x *
      0.62
      +
      seededX *
      0.38;


    node.y =
      rememberedPosition.y *
      0.62
      +
      seededY *
      0.38;

  } else {

    node.x =
      seededX;


    node.y =
      seededY;
  }


  node.z =
    0;


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


function assignVisualDepth(
  nodes
) {

  for (
    const node
    of nodes
  ) {

    node.z =
      Z_MIN
      +
      domainHash(
        `${node.domain}:z`
      ) *
      (
        Z_MAX -
        Z_MIN
      );


    node.vz =
      0;
  }
}


function resolveFinalNodeCollisions(
  nodes
) {

  const maxPasses =
    90;


  for (
    let pass = 0;
    pass < maxPasses;
    pass++
  ) {

    let largestOverlap =
      0;


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
          0.001
        ) {

          const angle =
            domainHash(
              `${a.domain}|${b.domain}:collision`
            ) *
            Math.PI *
            2;


          dx =
            Math.cos(
              angle
            );


          dy =
            Math.sin(
              angle
            );


          distance =
            1;
        }


        const minimumDistance =
          a.radius
          +
          b.radius
          +
          (
            a.layoutComponent ===
            b.layoutComponent

              ? 32

              : 48
          );


        const overlap =
          minimumDistance -
          distance;


        if (
          overlap <=
          0
        ) {

          continue;
        }


        largestOverlap =
          Math.max(
            largestOverlap,
            overlap
          );


        const directionX =
          dx /
          distance;


        const directionY =
          dy /
          distance;


        const mobilityA =
          calculateNodeMobility(
            a
          );


        const mobilityB =
          calculateNodeMobility(
            b
          );


        const totalMobility =
          Math.max(
            mobilityA +
            mobilityB,
            0.001
          );


        const moveA =
          overlap *
          (
            mobilityA /
            totalMobility
          );


        const moveB =
          overlap *
          (
            mobilityB /
            totalMobility
          );


        a.x -=
          directionX *
          moveA;


        a.y -=
          directionY *
          moveA;


        b.x +=
          directionX *
          moveB;


        b.y +=
          directionY *
          moveB;
      }
    }


    for (
      const node
      of nodes
    ) {

      constrainNodeToLayoutVolume(
        node
      );
    }


    if (
      largestOverlap <
      0.05
    ) {

      break;
    }
  }
}


// ==================================================
// Force Layout
// ==================================================

function createComponentForceLayout(
  nodes,
  edges
) {

  if (
    nodes.length ===
    0
  ) {

    return;
  }


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


  const components =
    buildLayoutComponents(
      nodes,
      layoutEdges,
      nodeMap
    );


  packLayoutComponents(
    components
  );


  for (
    const node
    of nodes
  ) {

    initializeNodeLayoutPosition(
      node,
      node.layoutComponentRef
    );
  }


  const iterations =
    680;


  for (
    let iteration = 0;
    iteration < iterations;
    iteration++
  ) {

    // ==================================================
    // Intra-component repulsion
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


        if (
          a.layoutComponent !==
          b.layoutComponent
        ) {

          continue;
        }


        let dx =
          b.x -
          a.x;


        let dy =
          b.y -
          a.y;


        let distanceSquared =
          dx * dx
          +
          dy * dy;


        if (
          distanceSquared <
          1
        ) {

          dx =
            1;


          dy =
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
            16000 +
            sizeFactor *
            150
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


    // ==================================================
    // Intra-component springs
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


      const distance =
        Math.max(
          Math.sqrt(
            dx * dx
            +
            dy * dy
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

          70
        );


      const desiredDistance =
        source.radius
        +
        target.radius
        +
        118
        -
        relationshipBonus;


      const strength =
        0.0034
        +
        Math.min(
          edge.count,
          12
        ) *
        0.0011;


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


      target.vx -=
        fx *
        targetMobility;


      target.vy -=
        fy *
        targetMobility;
    }


    // ==================================================
    // 2D collision
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


        const minimumDistance =
          a.radius
          +
          b.radius
          +
          (
            a.layoutComponent ===
            b.layoutComponent

              ? 28

              : 44
          );


        if (
          distance <
          minimumDistance
        ) {

          const overlap =
            minimumDistance -
            distance;


          const push =
            overlap *
            0.115;


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
    // Component center attraction
    // ==================================================

    for (
      const node
      of nodes
    ) {

      const component =
        node.layoutComponentRef;


      if (
        !component
      ) {

        continue;
      }


      const componentStrength =
        component.isIsolated

          ? 0.0048

          : 0.0016
            +
            Math.min(
              node.layoutIncidentWeight,
              12
            ) *
            0.00012;


      node.vx +=
        (
          component.centerX -
          node.x
        ) *
        componentStrength;


      node.vy +=
        (
          component.centerY -
          node.y
        ) *
        componentStrength;


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


      node.x +=
        node.vx;


      node.y +=
        node.vy;


      constrainNodeToLayoutVolume(
        node
      );
    }
  }


  resolveFinalNodeCollisions(
    nodes
  );


  assignVisualDepth(
    nodes
  );


  layoutPositionMemory =
    new Map(
      nodes.map(
        node => [
          node.domain,
          {
            x:
              node.x,

            y:
              node.y
          }
        ]
      )
    );
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


  const visualShiftX =
    0;


  const visualShiftY =
    0;


  /*
   * 2차 projection.
   *
   * 컴포넌트 패킹으로 계산된 위치를 유지한 뒤
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


function syncEdgeGlass(pair) { updateBridgeLens(pair); }

function createMapBackgroundImage() {
  const image = createSvgElement("image");
  image.setAttribute("href", chrome.runtime.getURL("visualization/assets/background.png"));
  image.setAttribute("x", "0");
  image.setAttribute("y", "0");
  image.setAttribute("width", WIDTH);
  image.setAttribute("height", HEIGHT);
  image.setAttribute("preserveAspectRatio", "xMidYMid slice");
  image.setAttribute("pointer-events", "none");
  image.setAttribute("data-map-background", "");
  positionMapBackground(image);
  return image;
}

function updateEdgeGelMaterial(pair) {
  if (!pair.aToB || !pair.bToA) {
    const forward = pair.aToB > 0;
    pair.gelElement.setAttribute("d", createTaperedRibbonPath(
      forward ? pair.nodeA : pair.nodeB,
      forward ? pair.nodeB : pair.nodeA,
      calculateEdgeStartWidth(forward ? pair.aToB : pair.bToA)
    ));
    return;
  }
  const a = pair.nodeA, b = pair.nodeB;
  const ax = a.renderX ?? a.screenX, ay = a.renderY ?? a.screenY;
  const bx = b.renderX ?? b.screenX, by = b.renderY ?? b.screenY;
  const ar = a.renderRadius ?? a.screenRadius, br = b.renderRadius ?? b.screenRadius;
  const distance = Math.hypot(bx - ax, by - ay);
  const gap = distance - ar - br;
  if (!Number.isFinite(gap) || gap <= 1) { pair.gelElement.setAttribute("d", ""); return; }
  const ux = (bx - ax) / distance, uy = (by - ay) / distance;
  const compact = 1 / (1 + gap / Math.max(1, (ar + br) * 0.7));
  const ah = Math.min((calculateEdgeStartWidth(pair.aToB) + ar * 0.4) * (1 + 0.35 * compact) / 2, ar * 0.65);
  const bh = Math.min((calculateEdgeStartWidth(pair.bToA) + br * 0.4) * (1 + 0.35 * compact) / 2, br * 0.65);
  const ao = Math.sqrt(Math.max(0, ar * ar - ah * ah)) - 0.5;
  const bo = Math.sqrt(Math.max(0, br * br - bh * bh)) - 0.5;
  const length = distance - ao - bo;
  let seed = 0;
  for (const char of [pair.a, pair.b].sort().join("|")) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) >>> 0;
  const bend = ((seed % 101) / 50 - 1) * Math.min(6, gap * 0.025);
  const neck = Math.max(1.2, Math.min(ah, bh) * (0.12 + compact * 0.32));
  const p = (t, width) => `${ax + ux * (ao + length * t) - uy * width} ${ay + uy * (ao + length * t) + ux * width}`;
  // One continuous outline. Matching tangents at the waist remove the union cusp.
  pair.gelElement.setAttribute("d", `M ${p(0, ah)}
    C ${p(0.12, ah * 0.32)} ${p(0.36, bend + neck)} ${p(0.5, bend + neck)}
    C ${p(0.64, bend + neck)} ${p(0.88, bh * 0.32)} ${p(1, bh)}
    L ${p(1, -bh)}
    C ${p(0.88, -bh * 0.32)} ${p(0.64, bend - neck)} ${p(0.5, bend - neck)}
    C ${p(0.36, bend - neck)} ${p(0.12, -ah * 0.32)} ${p(0, -ah)} Z`);
}

function calculateSimpleEdgeWidth(count) {
  // Absolute logarithmic scale keeps rare links fine and busy links bounded.
  return Math.min(2.2, 0.8 + 0.28 * Math.log2(Math.max(1, count)));
}

function updateEdgeHover(domain) {
  svg.querySelectorAll(".edge-pair").forEach(group => {
    group.classList.toggle("edge-hovered",
      domain != null && (group.dataset.a === domain || group.dataset.b === domain));
  });
}

function createSimpleEdgePath(source, target) {
  const sx = source.renderX ?? source.screenX;
  const sy = source.renderY ?? source.screenY;
  const tx = target.renderX ?? target.screenX;
  const ty = target.renderY ?? target.screenY;
  const sr = source.renderRadius ?? source.screenRadius;
  const tr = target.renderRadius ?? target.screenRadius;
  const distance = Math.hypot(tx - sx, ty - sy);
  if (!Number.isFinite(distance) || distance <= sr + tr + 1) return "";
  const ux = (tx - sx) / distance;
  const uy = (ty - sy) / distance;
  return `M ${sx + ux * sr} ${sy + uy * sr} L ${tx - ux * tr} ${ty - uy * tr}`;
}

function createTaperedRibbonPath(source, target, startWidth, endWidth = EDGE_END_WIDTH) {
  const sx = source.renderX ?? source.screenX;
  const sy = source.renderY ?? source.screenY;
  const tx = target.renderX ?? target.screenX;
  const ty = target.renderY ?? target.screenY;
  const sourceRadius = source.renderRadius ?? source.screenRadius;
  const targetRadius = target.renderRadius ?? target.screenRadius;
  const dx = tx - sx;
  const dy = ty - sy;
  const distance = Math.hypot(dx, dy);
  const gap = distance - sourceRadius - targetRadius;

  // Overlapping nodes have no visible bridge between their surfaces.
  if (!Number.isFinite(gap) || gap <= 1) return "";

  const ux = dx / distance;
  const uy = dy / distance;
  const nx = -uy;
  const ny = ux;

  // A short bridge retains its body; a stretched bridge develops a thin neck.
  // Normalize by node size so the material behaves consistently at every scale.
  const compactness = 1 / (1 + gap / Math.max(1, (sourceRadius + targetRadius) * 0.7));
  // Add a radius-proportional attachment width while retaining traffic weight.
  const attachmentWidth = startWidth + sourceRadius * 0.4;
  const startHalf = Math.min(attachmentWidth * (1 + 0.35 * compactness) / 2, sourceRadius * 0.65);
  const endHalf = Math.min(endWidth * (0.55 + 0.45 * compactness) / 2, startHalf, targetRadius * 0.4);
  const neckHalf = endHalf + (startHalf - endHalf) * (0.12 + 0.5 * compactness);

  // Sink each cap slightly into its bubble so the glue stays attached.
  const sourceOffset = Math.sqrt(Math.max(0, sourceRadius ** 2 - startHalf ** 2)) - 0.5;
  const targetOffset = Math.sqrt(Math.max(0, targetRadius ** 2 - endHalf ** 2)) - 0.5;
  const sourceX = sx + ux * sourceOffset;
  const sourceY = sy + uy * sourceOffset;
  const targetX = tx - ux * targetOffset;
  const targetY = ty - uy * targetOffset;
  const length = distance - sourceOffset - targetOffset;
  const point = (t, width) => [
    sourceX + ux * length * t + nx * width,
    sourceY + uy * length * t + ny * width
  ].join(" ");

  // Stable, pair-specific variation: no random changes between animation frames.
  const names = [source.domain ?? "source", target.domain ?? "target"].sort();
  let seed = 2166136261;
  for (const char of names.join("|")) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const shape = (seed & 255) / 255;
  const balance = ((seed >>> 8) & 255) / 255;
  const orientation = (source.domain ?? "source") === names[0] ? 1 : -1;
  const bend = (balance * 2 - 1) * orientation * Math.min(8, gap * 0.035, neckHalf * 0.65);
  const shoulder = 0.09 + shape * 0.11;
  const waist = 0.48 + balance * 0.18;
  const asymmetry = 0.78 + shape * 0.44;

  // Unequal shoulders and a gently bowed neck resemble stretched liquid.
  // Both sides retain positive width and the same longitudinal control positions.
  const tailHalf = endHalf + (neckHalf - endHalf) * 0.25;
  return `M ${point(0, startHalf)}
    C ${point(shoulder, bend * 0.45 + neckHalf * asymmetry)} ${point(waist, bend + tailHalf)} ${targetX + nx * endHalf} ${targetY + ny * endHalf}
    L ${targetX - nx * endHalf} ${targetY - ny * endHalf}
    C ${point(waist, bend - tailHalf)} ${point(shoulder, bend * 0.45 - neckHalf * (2 - asymmetry))} ${point(0, -startHalf)}
    Z`;
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


const faviconContrastCache = new Map();

function measureFaviconDarkness(pixels) {
  let weight = 0, darkness = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    if (alpha < 0.1) continue;
    const luminance = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
    darkness += alpha * Math.max(0, Math.min(1, (0.48 - luminance) / 0.38));
    weight += alpha;
  }
  return weight ? darkness / weight : 0;
}

function getFaviconDarkness(url) {
  if (faviconContrastCache.has(url)) return faviconContrastCache.get(url);
  const result = new Promise(resolve => {
    const image = new Image();
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve(value);
    };
    const timer = setTimeout(() => finish(0), 5000);
    // Cross-origin images need CORS permission for pixel analysis. A failure
    // must leave the original favicon usable, without guessing its brightness.
    if (/^https?:/.test(url) && new URL(url).origin !== location.origin) image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const context = canvas.getContext("2d", {willReadFrequently:true});
        context.drawImage(image, 0, 0, 32, 32);
        finish(measureFaviconDarkness(context.getImageData(0, 0, 32, 32).data));
      } catch { finish(0); }
    };
    image.onerror = () => finish(0);
    image.src = url;
  });
  // Bound retained URL promises during long-running history/period browsing.
  if (faviconContrastCache.size >= 256) faviconContrastCache.delete(faviconContrastCache.keys().next().value);
  faviconContrastCache.set(url, result);
  return result;
}

async function applyFaviconContrast(favicon, url) {
  const darkness = await getFaviconDarkness(url);
  if (!favicon.isConnected || favicon.getAttribute("href") !== url) return;
  // Shadows follow the alpha silhouette, never a circular backing plate.
  favicon.style.filter = darkness > 0.08
    ? `drop-shadow(0 0 0.65px rgba(255,255,255,${(darkness * 0.7).toFixed(3)})) drop-shadow(0 0 2.5px rgba(255,255,255,${(darkness * 0.4).toFixed(3)}))`
    : "none";
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

    favicon.style.filter = "none";
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

      applyFaviconContrast(favicon, favicon.getAttribute("href"));

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

  if (historyActive && node?.domain !== selectedDomain) node = null;

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

  updateEdgeHover(node?.domain ?? null);

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

      updateNodeLens(node);


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

      if (pair.lineElement) {
        pair.lineElement.setAttribute("d", createSimpleEdgePath(pair.nodeA, pair.nodeB));
      }
      if (pair.gelElement) {
        updateEdgeGelMaterial(pair);
        syncEdgeGlass(pair);
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

function selectNode(node, graph, { toggle = true, singleNode = false } = {}) {
  if (toggle && selectedDomain === node.domain) {
    clearSelection();
    return;
  }

  highlightNode(node.domain, graph, singleNode);
  showNodeDetail(node, graph);
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && selectedDomain !== null) {
    clearSelection();
  }
});

function clearSelection() {

  selectedDomain =
    null;

  document.querySelectorAll(".node-group.is-selected, .ranking-item.is-selected")
    .forEach(element => element.classList.remove("is-selected"));
  rankingListElement.querySelectorAll(".ranking-item")
    .forEach(item => item.setAttribute("aria-pressed", "false"));

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


  renderDetailPlaceholder();
}


function highlightNode(
  domain,
  graph,
  singleNode = false
) {

  selectedDomain =
    domain;

  const connected =
    new Set([
      domain
    ]);


  for (
    const edge
    of (singleNode ? [] : graph.edges)
  ) {

    if (
      edge.source ===
      domain
    ) {

      connected.add(
        edge.target
      );
    }


    if (
      edge.target ===
      domain
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

        group.classList.toggle("is-selected", group.dataset.domain === domain);

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
            domain
          ||
          group.dataset.b ===
            domain;


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

        item.setAttribute("aria-pressed", String(item.dataset.domain === domain));

        item.classList.toggle(
          "is-selected",

          item.dataset.domain ===
          domain
        );
      }
    );
}


function renderDetailPlaceholder() {

  const period =
    PERIODS[activePeriodKey] ??
    PERIODS.today;


  detailElement.innerHTML =
    "";


  const eyebrow =
    document.createElement(
      "div"
    );


  eyebrow.className =
    "panel-eyebrow";


  eyebrow.textContent =
    "사이트 상세정보";


  const title =
    document.createElement(
      "h2"
    );


  title.textContent =
    "사이트를 선택하세요";


  const description =
    document.createElement(
      "p"
    );


  description.className =
    "panel-description";


  description.textContent =
    `${getDisplayedPeriodLabel()} 지도나 이용률 순위에서 사이트를 선택하세요. 같은 사이트를 다시 누르거나 빈 공간 클릭, Esc 키로 선택을 해제할 수 있습니다.`;


  detailElement.append(
    eyebrow,
    title,
    description
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
    `${getDisplayedPeriodLabel()} · 선택한 사이트`;


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
      "방문 횟수",
      `${node.sessionCount}회`
    ],

    [
      "연결",
      `${new Set([...incoming.map(edge => edge.source), ...outgoing.map(edge => edge.target)]).size}개`
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

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "detail-clear-selection";
  clearButton.textContent = "선택 해제";
  clearButton.addEventListener("click", clearSelection);
  detailElement.appendChild(clearButton);

  if (incoming.length === 0 && outgoing.length === 0) {
    const empty = document.createElement("p");
    empty.className = "panel-description";
    empty.textContent = "선택한 기간에는 다른 사이트와의 이동 기록이 없습니다.";
    detailElement.appendChild(empty);
  }


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


      item.appendChild(createRelatedSiteButton(edge.source, edge.count, graph));


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


      item.appendChild(createRelatedSiteButton(edge.target, edge.count, graph));


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

function createRelatedSiteButton(domain, count, graph) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "detail-related-site";
  button.textContent = `${domain} · ${count}회`;
  button.addEventListener("click", () => {
    const node = graph.nodes.find(candidate => candidate.domain === domain);
    if (node) selectNode(node, graph, { toggle: false });
  });
  return button;
}

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

      item.setAttribute("aria-pressed", "false");


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

          selectNode(node, graph);
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

    <linearGradient id="edgeGlassLight" x1="0%" y1="0%" x2="35%" y2="100%">
      <stop offset="0%" stop-color="white" stop-opacity="0.12" />
      <stop offset="24%" stop-color="white" stop-opacity="0.04" />
      <stop offset="36%" stop-color="white" stop-opacity="0.38" />
      <stop offset="43%" stop-color="white" stop-opacity="0.04" />
      <stop offset="64%" stop-color="white" stop-opacity="0" />
      <stop offset="78%" stop-color="white" stop-opacity="0.2" />
      <stop offset="100%" stop-color="white" stop-opacity="0.04" />
    </linearGradient>
    <linearGradient id="edgeReflection" x1="0%" y1="0%" x2="25%" y2="100%">
      <stop offset="0%" stop-color="white" stop-opacity="0.8"/>
      <stop offset="30%" stop-color="white" stop-opacity="0.35"/>
      <stop offset="55%" stop-color="white" stop-opacity="0"/>
      <stop offset="100%" stop-color="white" stop-opacity="0.28"/>
    </linearGradient>
    <filter id="edgeSoftShadow" x="-40%" y="-80%" width="180%" height="260%">
      <feGaussianBlur stdDeviation="3"/>
      <feOffset dy="3"/>
    </filter>
    <filter id="edgeGlassDistortion" x="-15%" y="-30%" width="130%" height="160%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.018 0.035" numOctaves="2" seed="12" result="ripple" />
      <feDisplacementMap in="SourceGraphic" in2="ripple" scale="5" xChannelSelector="R" yChannelSelector="G" />
      <feGaussianBlur stdDeviation="0.35" />
    </filter>
    <filter id="edgeGlassGlow" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="softGlow" />
      <feMerge><feMergeNode in="softGlow" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>


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
  graph,
  range
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

  // Base and refracted copies share identical SVG coordinates, even on resize.
  const backgroundImage = createMapBackgroundImage();
  backgroundImage.setAttribute("class", "map-background");
  svg.appendChild(backgroundImage);
  svg.appendChild(createStarTwinkleLayer());


  /*
   * 같은 SVG에 기간별 handler가 누적되지 않게
   * property handler를 매번 새 graph 기준으로 교체한다.
   */
  svg.onpointermove =
    null;


  svg.onpointerleave =
    null;


  svg.onpointerdown =
    null;


  svg.onpointerup =
    null;


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
      `${range.label} · 선택 기간에 기록이 없습니다.`;


    rankingListElement.textContent =
      "아직 이용 기록이 없습니다.";


    return;
  }


  const defs =
    createDefinitions();


  /*
   * 중요도 계산도 여기서 이뤄진다.
   */
  createComponentForceLayout(
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

    const line = createSvgElement("path");
    line.setAttribute("class", "edge-line");
    line.style.strokeWidth = `${calculateSimpleEdgeWidth(pair.aToB + pair.bToA)}px`;
    line.setAttribute("d", createSimpleEdgePath(a, b));
    group.appendChild(line);
    pair.lineElement = line;


    const gel = createSvgElement("path");
    gel.setAttribute("class", "edge-ribbon");
    const surface = createLensSurface(defs, `edge-refraction-${edgePairs.indexOf(pair)}`);
    surface.group.setAttribute("class", "edge-glass");
    surface.image.setAttribute("class", "edge-refracted-background");
    pair.lensSurface = surface;
    pair.glassElement = createSvgElement("path");
    pair.glassElement.setAttribute("fill", "url(#edgeGlassLight)");
    pair.glassElement.setAttribute("opacity", "0.65");
    surface.group.appendChild(pair.glassElement);
    pair.reflectionElement = createSvgElement("path");
    pair.reflectionElement.setAttribute("fill", "none");
    pair.reflectionElement.setAttribute("stroke", "url(#edgeReflection)");
    pair.reflectionElement.setAttribute("stroke-width", "1.6");
    surface.group.appendChild(pair.reflectionElement);
    surface.overlays.push(pair.glassElement, pair.reflectionElement);
    pair.shadowElement = createSvgElement("path");
    pair.shadowElement.setAttribute("class", "edge-glass-shadow");
    pair.shadowElement.setAttribute("fill", "black");
    pair.shadowElement.setAttribute("opacity", "0.38");
    pair.shadowElement.setAttribute("filter", "url(#edgeSoftShadow)");
    group.appendChild(pair.shadowElement);
    group.appendChild(surface.group);
    group.appendChild(gel);
    pair.gelElement = gel;
    updateEdgeGelMaterial(pair);
    syncEdgeGlass(pair);


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


  const nodeLensLayer = createSvgElement("g");
  nodeLensLayer.setAttribute("class", "node-lens-layer");
  svg.appendChild(nodeLensLayer);

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

      node.lensSurface = createLensSurface(defs, `node-lens-${index}`);
      node.lensSurface.image.setAttribute("class", "node-refracted-background");
      nodeLensLayer.appendChild(node.lensSurface.group);
      updateNodeLens(node);


// ----------------------------------------------
// Hover glow texture
// ----------------------------------------------

/*
 * 하나의 투명 PNG를 모든 노드가 공유한다.
 *
 * 실제 물방울보다 훨씬 크게 그려서
 * 바깥쪽으로 빛이 자연스럽게 퍼지게 한다.
 */
const glowSize =
  node.screenRadius *
  NODE_GLOW_SIZE_MULTIPLIER;


const hoverGlow =
  createSvgElement(
    "image"
  );


hoverGlow.setAttribute(
  "href",
  NODE_GLOW_TEXTURE_URL
);


hoverGlow.setAttribute(
  "x",
  node.screenX -
  glowSize / 2
);


hoverGlow.setAttribute(
  "y",
  node.screenY -
  glowSize / 2
);


hoverGlow.setAttribute(
  "width",
  glowSize
);


hoverGlow.setAttribute(
  "height",
  glowSize
);


hoverGlow.setAttribute(
  "preserveAspectRatio",
  "xMidYMid meet"
);


hoverGlow.setAttribute(
  "class",
  "node-hover-glow"
);


/*
 * 반드시 droplet 본체보다 먼저 append한다.
 *
 * 그래야 글로우가 물방울 뒤에서 빛나는 것처럼 보인다.
 */
group.appendChild(
  hoverGlow
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
        NODE_FAVICON_SIZE_MULTIPLIER;


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


      bindNodeFavicon(node, favicon, fallback);

      // The supplied transparent bubble is painted above the favicon.
      // Adjust this multiplier if a replacement PNG has different padding.
      const bubbleSize = node.screenRadius * NODE_BUBBLE_SIZE_MULTIPLIER;
      const bubble = createSvgElement("image");
      bubble.setAttribute("href", getNodeBubbleTexture(node.domain));
      bubble.setAttribute("x", node.screenX - bubbleSize / 2);
      bubble.setAttribute("y", node.screenY - bubbleSize / 2);
      bubble.setAttribute("width", bubbleSize);
      bubble.setAttribute("height", bubbleSize);
      bubble.setAttribute("preserveAspectRatio", "xMidYMid meet");
      bubble.setAttribute("class", "node-bubble");
      group.appendChild(bubble);

      const hoverRim = createSvgElement("circle");
      hoverRim.setAttribute("cx", node.screenX);
      hoverRim.setAttribute("cy", node.screenY);
      hoverRim.setAttribute("r", node.screenRadius);
      hoverRim.setAttribute("class", "node-hover-rim");
      group.appendChild(hoverRim);


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

  svg.onpointermove =
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
    };


  svg.onpointerleave =
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
    };


  svg.onpointerdown =
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
    };


  svg.onpointerup =
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

        selectNode(upNode, graph);

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
    };


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
    `${range.label} · ${nodes.length}개 사이트 · ${transitionCount}번 이동 · ${formatDuration(totalTime)}`;


  startAnimation(
    nodes,
    edgePairs,
    nodeLayer,
    hoverLayer
  );
}


function updatePeriodFilterState() {

  periodFilterElement
    .querySelectorAll(
      ".period-filter-button"
    )
    .forEach(
      button => {

        const isActive =
          button.dataset.period ===
          activePeriodKey;


        button.classList.toggle(
          "is-active",
          isActive
        );


        button.setAttribute(
          "aria-pressed",
          String(
            isActive
          )
        );
      }
    );
}


let periodRenderVersion = 0;

async function renderActivePeriod() {
  stopHistoryPlayback();
  const version = ++periodRenderVersion;

  const range =
    getPeriodRange(
      activePeriodKey
    );


  updatePeriodFilterState();
  let sessions;
  try {
    const response = await requestMapData({ type: "GET_SESSIONS", range });
    if (version !== periodRenderVersion) return;
    sessions = clipSessionsToRange(response.sessions, range);
  } catch (error) {
    if (version === periodRenderVersion) summaryElement.textContent = `데이터를 불러오지 못했습니다: ${error.message}`;
    return;
  }


  const graph =
    aggregateSessions(
      sessions
    );


  updatePeriodFilterState();


  renderGraph(
    graph,
    range
  );

  updatePeriodComparison(range, sessions);


  const selectedNode =
    graph.nodes.find(
      node =>
        node.domain ===
        selectedDomain
    );


  if (
    selectedNode
  ) {

    selectNode(selectedNode, graph, { toggle: false });

  } else {

    clearSelection();
  }
}


function bindPeriodFilter() {

  periodFilterElement
    .querySelectorAll(
      ".period-filter-button"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",

          () => {

            const nextPeriodKey =
              button.dataset.period;


            if (
              !PERIODS[nextPeriodKey] ||
              (nextPeriodKey ===
                activePeriodKey &&
                !historyActive)
            ) {

              return;
            }


            activePeriodKey =
              nextPeriodKey;


            renderActivePeriod();
          }
        );
      }
    );
}


// ==================================================
// Initialize
// ==================================================

async function initialize() {

  try {

    await initializeSiteGrouping();
    initializeMapZoom();
    bindPeriodFilter();
    initializeHistoryTools();
    initializeDataTools();
    await renderActivePeriod();

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
