import {
  saveSession,
  getAllSessions
} from "../src/db.js";


// ==================================================
// Tracking Queue
// ==================================================

let trackingQueue =
  Promise.resolve();


/**
 * 탭 / 윈도우 이벤트가 동시에 발생해도
 * 추적 로직은 반드시 하나씩 순서대로 실행한다.
 */
function enqueueTracking(task) {

  trackingQueue =
    trackingQueue
      .then(
        () => task()
      )
      .catch(
        error => {

          console.error(
            "[Internet Map] Tracking error:",
            error
          );
        }
      );


  return trackingQueue;
}


// ==================================================
// Current Session
// ==================================================

/*
 * Manifest V3 Service Worker는
 * 필요하지 않으면 종료될 수 있다.
 *
 * 따라서 현재 추적 세션을
 * 전역 변수에만 보관하면 안 된다.
 *
 * chrome.storage.session을 사용해서
 * Service Worker가 재시작되어도 복구할 수 있게 한다.
 */

const CURRENT_SESSION_KEY =
  "currentSession";


// ==================================================
// Domain
// ==================================================

/**
 * URL에서 기록할 domain을 추출한다.
 *
 * 예:
 *
 * https://www.github.com/openai/test
 *
 * →
 *
 * github.com
 */
function extractDomain(urlString) {

  try {

    const url =
      new URL(
        urlString
      );


    /*
     * HTTP / HTTPS 사이트만 추적한다.
     *
     * chrome://
     * chrome-extension://
     * file://
     *
     * 등의 페이지는 기록하지 않는다.
     */
    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {

      return null;
    }


    let hostname =
      url.hostname;


    /*
     * www. 제거
     */
    if (
      hostname.startsWith(
        "www."
      )
    ) {

      hostname =
        hostname.slice(4);
    }


    return hostname;

  } catch {

    return null;
  }
}


// ==================================================
// Current Session Storage
// ==================================================

async function getCurrentSession() {

  const result =
    await chrome.storage.session.get(
      CURRENT_SESSION_KEY
    );


  return (
    result[
      CURRENT_SESSION_KEY
    ] ??
    null
  );
}


async function setCurrentSession(
  session
) {

  await chrome.storage.session.set({

    [CURRENT_SESSION_KEY]:
      session

  });
}


async function clearCurrentSession() {

  await chrome.storage.session.remove(
    CURRENT_SESSION_KEY
  );
}


// ==================================================
// Close Session
// ==================================================

/**
 * 현재 진행 중인 세션을 종료하고
 * IndexedDB에 저장한다.
 */
async function closeCurrentSession() {

  const current =
    await getCurrentSession();


  if (!current) {

    return;
  }


  const endedAt =
    Date.now();


  const duration =
    endedAt -
    current.startedAt;


  /*
   * 1초 미만 체류는
   * 순간적인 탭 이동이나 노이즈로 처리한다.
   */
  if (
    duration >=
    1000
  ) {

    await saveSession({

      domain:
        current.domain,


      /*
       * Chrome favicon API 조회용 페이지 URL.
       */
      faviconPageUrl:
        current.faviconPageUrl ??
        null,


      /*
       * Chrome이 실제 탭에서 제공한 favicon URL.
       */
      faviconUrl:
        current.faviconUrl ??
        null,


      startedAt:
        current.startedAt,


      endedAt,


      duration,


      /*
       * 이전에 보고 있던 사이트.
       */
      fromDomain:
        current.fromDomain ??
        null

    });


    console.log(
      "[Internet Map] Session saved:",
      current.domain,
      `${Math.round(
        duration /
        1000
      )} sec`
    );
  }


  await clearCurrentSession();
}


// ==================================================
// Start Session
// ==================================================

/**
 * 새로운 사이트 세션을 시작한다.
 */
async function startSession(
  domain,
  faviconPageUrl = null,
  faviconUrl = null
) {

  if (!domain) {

    return;
  }


  const previous =
    await getCurrentSession();


  /*
   * 같은 도메인이라면
   * 세션을 다시 만들지 않는다.
   *
   * 대신 favicon 정보가 나중에 로드되었을 경우
   * 현재 세션의 favicon 정보만 갱신한다.
   */
  if (
    previous?.domain ===
    domain
  ) {

    let changed =
      false;


    if (
      faviconPageUrl &&
      faviconPageUrl !==
        previous.faviconPageUrl
    ) {

      previous.faviconPageUrl =
        faviconPageUrl;


      changed =
        true;
    }


    if (
      faviconUrl &&
      faviconUrl !==
        previous.faviconUrl
    ) {

      previous.faviconUrl =
        faviconUrl;


      changed =
        true;
    }


    if (changed) {

      await setCurrentSession(
        previous
      );
    }


    return;
  }


  let fromDomain =
    null;


  /*
   * 기존 사이트를 보고 있었다면
   * 먼저 그 세션을 종료한다.
   */
  if (previous) {

    fromDomain =
      previous.domain;


    await closeCurrentSession();
  }


  const session = {

    domain,


    faviconPageUrl,


    faviconUrl,


    startedAt:
      Date.now(),


    fromDomain

  };


  await setCurrentSession(
    session
  );


  console.log(
    "[Internet Map] Tracking:",
    domain
  );
}


// ==================================================
// Inspect Active Tab
// ==================================================

/**
 * 현재 Chrome에서 실제로 보고 있는
 * 활성 탭을 검사한다.
 */
async function inspectActiveTab() {

  const windows =
    await chrome.windows.getAll();


  const focusedWindow =
    windows.find(
      window =>
        window.focused
    );


  /*
   * Chrome 자체가 focus를 잃은 경우.
   *
   * 예:
   *
   * Chrome
   * ↓
   * VS Code
   *
   * 이 시간은 웹사이트 사용시간에 포함하지 않는다.
   */
  if (!focusedWindow) {

    await closeCurrentSession();

    return;
  }


  const tabs =
    await chrome.tabs.query({

      active:
        true,

      windowId:
        focusedWindow.id

    });


  const tab =
    tabs[0];


  if (!tab?.url) {

    await closeCurrentSession();

    return;
  }


  const domain =
    extractDomain(
      tab.url
    );


  /*
   * chrome-extension:// 등의 페이지.
   *
   * Internet Map 자체를 보고 있는 시간도
   * 웹사이트 이용시간에는 포함하지 않는다.
   */
  if (!domain) {

    await closeCurrentSession();

    return;
  }


  await startSession(

    domain,


    /*
     * favicon API에서 페이지 아이콘을 찾을 때 사용.
     */
    tab.url,


    /*
     * Chrome 탭이 직접 제공하는 favicon.
     */
    tab.favIconUrl ??
      null
  );
}


// ==================================================
// Tab Activated
// ==================================================

/*
 * 현재 활성 탭 변경
 *
 * github.com
 * ↓
 * youtube.com
 */
chrome.tabs.onActivated.addListener(

  () => {

    enqueueTracking(
      () =>
        inspectActiveTab()
    );
  }
);


// ==================================================
// Tab Updated
// ==================================================

/*
 * 같은 탭에서 페이지 이동 또는
 * favicon 로드가 발생했을 때.
 */
chrome.tabs.onUpdated.addListener(

  (
    tabId,
    changeInfo,
    tab
  ) => {

    if (
      tab.active &&
      (
        changeInfo.url ||
        changeInfo.favIconUrl ||
        changeInfo.status ===
          "complete"
      )
    ) {

      enqueueTracking(
        () =>
          inspectActiveTab()
      );
    }
  }
);


// ==================================================
// Window Focus
// ==================================================

/*
 * Chrome → 다른 프로그램
 *
 * 또는
 *
 * Chrome Window A
 * →
 * Chrome Window B
 */
chrome.windows.onFocusChanged.addListener(

  windowId => {

    enqueueTracking(

      async () => {

        if (
          windowId ===
          chrome.windows.WINDOW_ID_NONE
        ) {

          await closeCurrentSession();

          return;
        }


        await inspectActiveTab();
      }
    );
  }
);


// ==================================================
// Extension Installed
// ==================================================

chrome.runtime.onInstalled.addListener(

  () => {

    enqueueTracking(

      async () => {

        await chrome.storage.local.set({

          trackingEnabled:
            true

        });


        console.log(
          "[Internet Map] Installed"
        );


        await inspectActiveTab();
      }
    );
  }
);


// ==================================================
// Chrome Startup
// ==================================================

chrome.runtime.onStartup.addListener(

  () => {

    enqueueTracking(
      () =>
        inspectActiveTab()
    );
  }
);


// ==================================================
// Message API
// ==================================================

/*
 * visualization.js에서
 * 저장된 세션 데이터를 요청할 때 사용.
 */
chrome.runtime.onMessage.addListener(

  (
    message,
    sender,
    sendResponse
  ) => {

    if (
      message.type ===
      "GET_SESSIONS"
    ) {

      getAllSessions()

        .then(
          sessions => {

            sendResponse({

              sessions

            });
          }
        )

        .catch(
          error => {

            sendResponse({

              error:
                error.message

            });
          }
        );


      /*
       * 비동기 sendResponse 사용.
       */
      return true;
    }
  }
);


// ==================================================
// Open Internet Map
// ==================================================

/**
 * Internet Map 화면을 연다.
 *
 * 이미 Internet Map 탭이 존재하면
 * 새 탭을 계속 만드는 대신
 * 기존 탭으로 이동한다.
 */
async function openInternetMap() {

  const visualizationUrl =
    chrome.runtime.getURL(
      "visualization/visualization.html"
    );


  const tabs =
    await chrome.tabs.query({});


  const existingTab =
    tabs.find(
      tab =>
        tab.url ===
        visualizationUrl
    );


  /*
   * 이미 열려 있음.
   */
  if (
    existingTab?.id !==
    undefined
  ) {

    await chrome.tabs.update(
      existingTab.id,
      {
        active:
          true
      }
    );


    /*
     * 다른 Chrome Window에 있다면
     * 그 Window 자체도 앞으로 가져온다.
     */
    if (
      existingTab.windowId !==
      undefined
    ) {

      await chrome.windows.update(
        existingTab.windowId,
        {
          focused:
            true
        }
      );
    }


    return;
  }


  /*
   * 열려 있지 않다면 새 탭 생성.
   */
  await chrome.tabs.create({

    url:
      visualizationUrl

  });
}


/*
 * 확장프로그램 아이콘 클릭
 *
 * Popup 없이 바로 Internet Map으로 이동한다.
 */
chrome.action.onClicked.addListener(

  () => {

    openInternetMap()
      .catch(
        error => {

          console.error(
            "[Internet Map] Failed to open visualization:",
            error
          );
        }
      );
  }
);


// ==================================================
// Service Worker Restore
// ==================================================

/*
 * Service Worker가 다시 로드되었을 때
 * 현재 브라우저 상황을 복구한다.
 *
 * 다른 이벤트와 동시에 처리되지 않도록
 * queue를 거친다.
 */
enqueueTracking(
  () =>
    inspectActiveTab()
);