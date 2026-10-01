const DB_NAME =
  "internet-map-db";

const DB_VERSION =
  1;

const SESSION_STORE =
  "sessions";


/**
 * Internet Map용 IndexedDB를 연다.
 */
export function openDatabase() {
  return new Promise(
    (resolve, reject) => {

      const request =
        indexedDB.open(
          DB_NAME,
          DB_VERSION
        );


      request.onupgradeneeded =
        () => {

          const db =
            request.result;


          if (
            !db.objectStoreNames.contains(
              SESSION_STORE
            )
          ) {

            const store =
              db.createObjectStore(
                SESSION_STORE,
                {
                  keyPath: "id",
                  autoIncrement: true
                }
              );


            store.createIndex(
              "domain",
              "domain",
              {
                unique: false
              }
            );


            store.createIndex(
              "startedAt",
              "startedAt",
              {
                unique: false
              }
            );
          }
        };


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
 * 브라우징 세션 하나 저장.
 */
export async function saveSession(
  session
) {
  const db =
    await openDatabase();


  return new Promise(
    (resolve, reject) => {

      const transaction =
        db.transaction(
          SESSION_STORE,
          "readwrite"
        );


      const store =
        transaction.objectStore(
          SESSION_STORE
        );


      const request =
        store.add(
          session
        );


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


      transaction.oncomplete =
        () => {
          db.close();
        };
    }
  );
}


/**
 * 모든 세션 조회.
 *
 * 개발 단계에서는 전체 조회.
 * 데이터가 많아지면 기간 기반 조회로 변경할 예정.
 */
export async function getAllSessions() {
  const db =
    await openDatabase();


  return new Promise(
    (resolve, reject) => {

      const transaction =
        db.transaction(
          SESSION_STORE,
          "readonly"
        );


      const store =
        transaction.objectStore(
          SESSION_STORE
        );


      const request =
        store.getAll();


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


      transaction.oncomplete =
        () => {
          db.close();
        };
    }
  );
}