import firebase from "firebase/compat/app";
import "firebase/compat/database";

const firebaseConfig = {
  apiKey: "AIzaSyBwTXt8sOhNfW2lzu7430g4wcHn9dTMZeA",
  databaseURL: "https://las-vegas-poker-f2d6a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "las-vegas-poker-f2d6a"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

export const db = firebase.database();
export default firebase;
