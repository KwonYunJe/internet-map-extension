const DB_NAME =
  "internet-map-db";

const DB_VERSION =
  2;

const SESSION_STORE =
  "sessions";


let databasePromise =
  null;


function ensureSessionIndexes(
  store
) {

  if (
    !store.indexNames.contains(
      "domain"
    )
  ) {

    store.createIndex(
      "domain",
      "domain",
      {
        unique: false
      }
    );
  }


  if (
    !store.indexNames.contains(
      "startedAt"
    )
  ) {

    store.createIndex(
      "startedAt",
      "startedAt",
      {
        unique: false
      }
    );
  }


  if (
    !store.indexNames.contains(
      "endedAt"
    )
  ) {

    store.createIndex(
      "endedAt",
      "endedAt",
      {
        unique: false
      }
    );
  }
}


/**
 * Internet Map용 IndexedDB를 연다.
 */
export function openDatabase() {

  if (
    databasePromise
  ) {

    return databasePromise;
  }


  databasePromise =
    new Promise(
      (
        resolve,
        reject
      ) => {

        const request =
          indexedDB.open(
            DB_NAME,
            DB_VERSION
          );


        request.onupgradeneeded =
          () => {

            const db =
              request.result;


            let store;


            if (
              db.objectStoreNames.contains(
                SESSION_STORE
              )
            ) {

              store =
                request
                  .transaction
                  .objectStore(
                    SESSION_STORE
                  );

            } else {

              store =
                db.createObjectStore(
                  SESSION_STORE,
                  {
                    keyPath:
                      "id",

                    autoIncrement:
                      true
                  }
                );
            }


            ensureSessionIndexes(
              store
            );
          };


        request.onsuccess =
          () => {
            request.result.onversionchange = () => {
              request.result.close();
              databasePromise = null;
            };
            resolve(
              request.result
            );
          };


        request.onerror =
          () => {
            databasePromise =
              null;

            reject(
              request.error
            );
          };
      }
    );


  return databasePromise;
}


/**
 * 브라우징 세션 하나 저장.
 */
export async function saveSession(
  session
) {
  const db =
    await openDatabase();


  return new Promise(
    (
      resolve,
      reject
    ) => {

      const transaction =
        db.transaction(
          SESSION_STORE,
          "readwrite"
        );


      transaction
        .objectStore(
          SESSION_STORE
        )
        .add(
          session
        );


      transaction.oncomplete =
        () => {
          resolve();
        };


      transaction.onerror =
        () => {
          reject(
            transaction.error
          );
        };


      transaction.onabort =
        () => {
          reject(
            transaction.error
          );
        };
    }
  );
}


/**
 * 모든 세션 조회.
 */
export async function getAllSessions() {
  const db =
    await openDatabase();


  return new Promise(
    (
      resolve,
      reject
    ) => {

      const transaction =
        db.transaction(
          SESSION_STORE,
          "readonly"
        );


      const request =
        transaction
          .objectStore(
            SESSION_STORE
          )
          .getAll();


      request.onsuccess =
        () => {
          resolve(
            request.result
          );
        };


      request.onerror =
        () => {
          reject(
            request.error
          );
        };
    }
  );
}


/**
 * 기간과 겹치는 세션 조회.
 *
 * endedAt > range.start 후보를 인덱스로 좁힌 뒤
 * startedAt < range.end 조건을 적용한다.
 */
export async function getSessionsInRange(
  range
) {

  if (
    !range ||
    range.start ===
      null ||
    range.end ===
      null
  ) {

    return getAllSessions();
  }


  const start =
    Number(
      range.start
    );


  const end =
    Number(
      range.end
    );


  if (
    !Number.isFinite(
      start
    ) ||
    !Number.isFinite(
      end
    ) ||
    end <=
      start
  ) {

    return [];
  }


  const db =
    await openDatabase();


  return new Promise(
    (
      resolve,
      reject
    ) => {

      const transaction =
        db.transaction(
          SESSION_STORE,
          "readonly"
        );


      const request =
        transaction
          .objectStore(
            SESSION_STORE
          )
          .index(
            "endedAt"
          )
          .getAll(
            IDBKeyRange.lowerBound(
              start,
              true
            )
          );


      request.onsuccess =
        () => {
          resolve(
            request
              .result
              .filter(
                session =>
                  Number(
                    session.startedAt
                  ) <
                  end
              )
          );
        };


      request.onerror =
        () => {
          reject(
            request.error
          );
        };
    }
  );
}


function normalizeTimestamp(
  value,
  field
) {

  const timestamp =
    typeof value ===
    "number"

      ? value

      : Date.parse(
          value
        );


  if (
    !Number.isFinite(
      timestamp
    )
  ) {

    throw new Error(
      `${field} 값이 올바르지 않습니다.`
    );
  }


  return timestamp;
}


function normalizeDomain(
  value,
  field
) {

  if (
    typeof value !==
      "string"
  ) {

    throw new Error(
      `${field} 값이 올바르지 않습니다.`
    );
  }


  const normalized =
    value
      .trim()
      .toLowerCase();


  if (
    !normalized ||
    normalized.length >
      253 ||
    normalized.includes(
      "/"
    ) ||
    normalized.includes(
      " "
    )
  ) {

    throw new Error(
      `${field} 도메인 형식이 올바르지 않습니다.`
    );
  }

  try {
    const url = new URL(`https://${normalized}`);
    if (url.hostname !== normalized || url.port || url.username || url.password || /[\s|?#]/.test(normalized)) throw new Error();
  } catch {
    throw new Error(`${field} 도메인 형식이 올바르지 않습니다.`);
  }


  return normalized;
}


function normalizeOptionalUrl(
  value,
  field
) {

  if (
    value ===
      null ||
    value ===
      undefined ||
    value ===
      ""
  ) {

    return null;
  }


  if (
    typeof value !==
    "string"
  ) {

    throw new Error(
      `${field} URL 값이 올바르지 않습니다.`
    );
  }


  let url;


  try {

    url =
      new URL(
        value
      );

  } catch {

    throw new Error(
      `${field} URL 값이 올바르지 않습니다.`
    );
  }


  if (
    ![
      "http:",
      "https:",
      "data:",
      "blob:",
      "chrome-extension:"
    ].includes(
      url.protocol
    )
  ) {

    throw new Error(
      `${field} URL 프로토콜을 지원하지 않습니다.`
    );
  }


  return value;
}


function normalizeImportedSession(
  session
) {

  if (
    !session ||
    typeof session !==
      "object"
  ) {

    throw new Error(
      "세션 항목이 올바르지 않습니다."
    );
  }


  const startedAt =
    normalizeTimestamp(
      session.startedAt,
      "startedAt"
    );


  const endedAt =
    normalizeTimestamp(
      session.endedAt,
      "endedAt"
    );


  if (
    endedAt <=
    startedAt
  ) {

    throw new Error(
      "endedAt은 startedAt보다 뒤여야 합니다."
    );
  }

  if (startedAt < 0 || endedAt > 8640000000000000 ||
      (session.duration !== undefined && (typeof session.duration !== "number" ||
        !Number.isFinite(session.duration) || session.duration < 0 || session.duration > endedAt - startedAt))) {
    throw new Error("세션 시간 또는 duration 값이 올바르지 않습니다.");
  }


  return {
    domain:
      normalizeDomain(
        session.domain,
        "domain"
      ),

    faviconPageUrl:
      normalizeOptionalUrl(
        session.faviconPageUrl,
        "faviconPageUrl"
      ),

    faviconUrl:
      normalizeOptionalUrl(
        session.faviconUrl,
        "faviconUrl"
      ),

    startedAt,

    endedAt,

    duration:
      session.duration ?? (endedAt - startedAt),

    fromDomain:
      session.fromDomain

        ? normalizeDomain(
            session.fromDomain,
            "fromDomain"
          )

        : null
  };
}


function createSessionFingerprint(
  session
) {

  return [
    session.domain,
    session.startedAt,
    session.endedAt,
    session.fromDomain ??
      ""
  ].join(
    "|"
  );
}


export async function importSessions(
  sessions
) {

  if (
    !Array.isArray(
      sessions
    )
  ) {

    throw new Error(
      "세션 목록이 배열이 아닙니다."
    );
  }


  const normalizedSessions =
    sessions.map(
      normalizeImportedSession
    );


  const db =
    await openDatabase();


  return new Promise(
    (
      resolve,
      reject
    ) => {

      const transaction =
        db.transaction(
          SESSION_STORE,
          "readwrite"
        );


      const store =
        transaction.objectStore(
          SESSION_STORE
        );


      const getRequest =
        store.getAll();


      let imported =
        0;


      let skipped =
        0;


      getRequest.onsuccess =
        () => {

          const fingerprints =
            new Set(
              getRequest
                .result
                .map(
                  createSessionFingerprint
                )
            );


          for (
            const session
            of normalizedSessions
          ) {

            const fingerprint =
              createSessionFingerprint(
                session
              );


            if (
              fingerprints.has(
                fingerprint
              )
            ) {

              skipped +=
                1;

              continue;
            }


            fingerprints.add(
              fingerprint
            );


            store.add(
              session
            );


            imported +=
              1;
          }
        };


      getRequest.onerror =
        () => {
          reject(
            getRequest.error
          );
        };


      transaction.oncomplete =
        () => {
          resolve({
            imported,
            skipped
          });
        };


      transaction.onerror =
        () => {
          reject(
            transaction.error
          );
        };


      transaction.onabort =
        () => {
          reject(
            transaction.error
          );
        };
    }
  );
}


export async function clearSessions() {
  const db =
    await openDatabase();


  return new Promise(
    (
      resolve,
      reject
    ) => {

      const transaction =
        db.transaction(
          SESSION_STORE,
          "readwrite"
        );


      transaction
        .objectStore(
          SESSION_STORE
        )
        .clear();


      transaction.oncomplete =
        () => {
          resolve();
        };


      transaction.onerror =
        () => {
          reject(
            transaction.error
          );
        };


      transaction.onabort =
        () => {
          reject(
            transaction.error
          );
        };
    }
  );
}
