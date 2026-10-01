const statusElement =
  document.querySelector(
    "#status"
  );


const outputElement =
  document.querySelector(
    "#output"
  );


const showDataButton =
  document.querySelector(
    "#showData"
  );


const openMapButton =
  document.querySelector(
    "#openMap"
  );


async function loadCurrentStatus() {
  const result =
    await chrome.storage.session.get(
      "currentSession"
    );


  const session =
    result.currentSession;


  if (!session) {

    statusElement.textContent =
      "현재 추적 중인 사이트가 없습니다.";

    return;
  }


  statusElement.textContent =
    `현재: ${session.domain}`;
}


openMapButton.addEventListener(
  "click",
  () => {

    chrome.tabs.create({
      url:
        chrome.runtime.getURL(
          "visualization/visualization.html"
        )
    });
  }
);


showDataButton.addEventListener(
  "click",
  () => {

    chrome.runtime.sendMessage(
      {
        type:
          "GET_SESSIONS"
      },

      response => {

        if (
          response?.error
        ) {

          outputElement.textContent =
            response.error;

          return;
        }


        outputElement.textContent =
          JSON.stringify(
            response?.sessions ??
              [],
            null,
            2
          );
      }
    );
  }
);


loadCurrentStatus();